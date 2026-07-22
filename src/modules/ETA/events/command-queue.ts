import { randomUUID } from 'crypto';
import { logger } from '@platform/logger';
import { OsrmRouter } from '../router/osrm.router';
import {
  DISPATCH_COMMANDS,
  DISPATCH_EVENTS,
  DISPATCH_EXCHANGE,
  DispatchCreateCommand,
  DispatchAgentSelectionCommand,
  DispatchAgentAssignmentCommand,
  DispatchCreatedEvent,
  AgentNotifiedEvent,
  AgentAssignedEvent,
  DispatchCommandPayload,
} from '../types/events';
import { IEventBus } from 'src/interfaces/event-bus.interface';
import { CacheService, GeoSearchResult } from '@platform/cache';

/**
 * Shared constant for the dispatch engine consumer queue name.
 */
const DISPATCH_CONSUMER_QUEUE = 'dispatch-engine.commands.queue';

/**
 * Command queue that listens to dispatch commands from the orchestrator,
 * computes routes via OsrmRouter, and publishes result events.
 *
 * On startup (`provision()`):
 * 1. Connects the event bus
 * 2. Asserts exchange
 * 3. Asserts queue
 * 4. Binds all dispatch command routing keys
 * 5. Starts consuming
 *
 * On each incoming message (`handleCommand()`):
 * 1. Extracts coordinates from the payload
 * 2. Calls OsrmRouter.getRoutes() to compute agent→restaurant→customer routes
 * 3. Publishes the corresponding result event (e.g. dispatch.v1.created)
 * 4. Acks the message
 */
export class DispatchCommandQueue {
  private provisioned = false;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly router: OsrmRouter,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Provision the queue: connect, assert topology, bind routing keys, and start consuming.
   *
   * @remarks
   * - Idempotent: safe to call multiple times; only provisions once.
   * - Must be called after the application bootstraps (server.start or index.ts).
   */
  async provision(): Promise<void> {
    if (this.provisioned) {
      logger.warn('DispatchCommandQueue already provisioned — skipping');
      return;
    }

    logger.info('Provisioning DispatchCommandQueue...');

    /* 1. Connect the event bus */
    await this.eventBus.connect();

    /* 2. Subscribe to all dispatch command routing keys */
    const commandRoutingKeys = Object.values(DISPATCH_COMMANDS);

    await this.eventBus.subscribe<DispatchCommandPayload>(
      DISPATCH_CONSUMER_QUEUE,
      commandRoutingKeys,
      this.handleCommand.bind(this),
    );

    this.provisioned = true;

    logger.info('DispatchCommandQueue provisioned successfully', {
      queue: DISPATCH_CONSUMER_QUEUE,
      routingKeys: commandRoutingKeys,
      exchange: DISPATCH_EXCHANGE.name,
    });
  }

  /**
   * Handle an incoming dispatch command by extracting the payload,
   * computing routes, and publishing the appropriate result event.
   */
  private async handleCommand(payload: DispatchCommandPayload): Promise<void> {
    logger.info('Processing dispatch command', {
      type: this.resolveCommandType(payload),
      order_id: (payload as DispatchCreateCommand).order_id,
    });

    /* Dispatch based on the command type */
    if (this.isCreateCommand(payload)) {
      await this.handleCreateCommand(payload);
    } else if (this.isAgentSelectionCommand(payload)) {
      await this.handleAgentSelectionCommand(payload);
    } else if (this.isAgentAssignmentCommand(payload)) {
      await this.handleAgentAssignmentCommand(payload);
    } else {
      logger.warn('Unknown dispatch command payload', { payload });
    }
  }

  /**
   * Handle `dispatch.v1.request-creation`:
   * Compute agent→restaurant→customer routes and publish `dispatch.v1.created`.
   */
  private async handleCreateCommand(
    payload: DispatchCreateCommand,
  ): Promise<void> {
    const dispatchId = randomUUID();

    /* Get all of the delivery agents within the 2KM radius of the restaurant and if there are none then increase the radius to 5KM and max 7KM for 3 times and if no delivery agents are there then publish the cancel event */
    const nearbyDeliveryAgents = await this.getNearbyDeliveryAgents({
      restaurantCoords: {
        longitude: payload.restaurant_coords.longitude,
        latitude: payload.restaurant_coords.latitude,
      },
    });

    /* Compute routes (in a real scenario, deliveryAgentCoords would come from
       a nearby-agent lookup service; here we use a placeholder) */
    const routesResult = await Promise.allSettled(
      nearbyDeliveryAgents.map((nda) =>
        this.router.getRoutes({
          restaurantCoords: {
            longitude: payload.restaurant_coords.longitude,
            latitude: payload.restaurant_coords.latitude,
          },
          customerCoords: {
            longitude: payload.customer_coords.longitude,
            latitude: payload.customer_coords.latitude,
          },
          deliveryAgentCoords: {
            longitude: nda.coordinates.latitude,
            latitude: nda.coordinates.longitude,
          },
        }),
      ),
    );

    /* Extract ETA from OSRM response */
    const agentToRestaurant = routesResult.map((routeRes) => {
      if (routeRes.status === 'rejected') {
        logger.warn('Failed to fetch route for delivery agent', {
          reason: routeRes.reason,
        });

        return;
      }

      if (routeRes.status === 'fulfilled')
        return this.extractRouteSummary(
          routeRes.value.agentToRestaurantResponse,
        );
    });

    const restaurantToCustomer = routesResult.map((routeRes) => {
      if (routeRes.status === 'rejected') {
        logger.warn('Failed to fetch route for delivery agent', {
          reason: routeRes.reason,
        });
        return;
      }

      if (routeRes.status === 'fulfilled')
        return this.extractRouteSummary(
          routeRes.value.restaurantToCustomerResponse,
        );
    });

    /* Now compare and find out the ETA for all of these DAs */
    logger.log('Agent to restaurant', agentToRestaurant);
    logger.log('Restaurant to customer', restaurantToCustomer);

    // const event: DispatchCreatedEvent = {
    //   dispatch_id: dispatchId,
    //   order_id: payload.order_id,
    //   agent_to_restaurant: {
    //     distance_meters: agentToRestaurant.distance,
    //     duration_seconds: agentToRestaurant.duration,
    //     polyline: agentToRestaurant.geometry,
    //   },
    //   restaurant_to_customer: {
    //     distance_meters: restaurantToCustomer.distance,
    //     duration_seconds: restaurantToCustomer.duration,
    //     polyline: restaurantToCustomer.geometry,
    //   },
    //   total_eta_seconds:
    //     agentToRestaurant.duration + restaurantToCustomer.duration,
    //   created_at: new Date().toISOString(),
    // };

    // await this.eventBus.publish(DISPATCH_EVENTS.CREATED, event);

    // logger.info('Published dispatch.v1.created', {
    //   dispatch_id: dispatchId,
    //   order_id: payload.order_id,
    //   total_eta_seconds: event.total_eta_seconds,
    // });
  }

  /**
   * Handle `dispatch.v1.request-agent-selection`:
   * Agents are notified via external mechanism; publish `agent.v1.notified`.
   */
  private async handleAgentSelectionCommand(
    payload: DispatchAgentSelectionCommand,
  ): Promise<void> {
    /*
     * In a production system, this would:
     * 1. Query nearby delivery agents from Redis geospatial index
     * 2. Rank them by ETA + load + rating
     * 3. Send push notification / WebSocket to the top N agents
     * 4. Wait for the first agent to accept
     *
     * For now we publish the NOTIFIED event to advance the saga.
     */

    const event: AgentNotifiedEvent = {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
      agent_id: 'pending', // Resolved when agent accepts
      notified_at: new Date().toISOString(),
    };

    await this.eventBus.publish(DISPATCH_EVENTS.AGENT_NOTIFIED, event);

    logger.info('Published agent.v1.notified', {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
    });
  }

  /**
   * Handle `dispatch.v1.confirm-agent-assignment`:
   * Confirm the agent assignment and publish `agent.v1.assigned`.
   */
  private async handleAgentAssignmentCommand(
    payload: DispatchAgentAssignmentCommand,
  ): Promise<void> {
    const event: AgentAssignedEvent = {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
      agent_id: payload.agent_id,
      assigned_at: new Date().toISOString(),
    };

    await this.eventBus.publish(DISPATCH_EVENTS.AGENT_ASSIGNED, event);

    logger.info('Published agent.v1.assigned', {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
      agent_id: payload.agent_id,
    });
  }

  /**
   * Resolve the command type from the payload structure.
   */
  private resolveCommandType(payload: DispatchCommandPayload): string {
    if (this.isCreateCommand(payload))
      return DISPATCH_COMMANDS.REQUEST_CREATION;
    if (this.isAgentSelectionCommand(payload))
      return DISPATCH_COMMANDS.REQUEST_AGENT_SELECTION;
    if (this.isAgentAssignmentCommand(payload))
      return DISPATCH_COMMANDS.CONFIRM_AGENT_ASSIGNMENT;
    return 'unknown';
  }

  /**
   * Type guard for DispatchCreateCommand.
   */
  private isCreateCommand(
    payload: DispatchCommandPayload,
  ): payload is DispatchCreateCommand {
    return (
      'order_id' in payload &&
      'restaurant_coords' in payload &&
      'customer_coords' in payload &&
      !('agent_id' in payload)
    );
  }

  /**
   * Type guard for DispatchAgentSelectionCommand.
   */
  private isAgentSelectionCommand(
    payload: DispatchCommandPayload,
  ): payload is DispatchAgentSelectionCommand {
    return (
      'dispatch_id' in payload &&
      'restaurant_coords' in payload &&
      'customer_coords' in payload &&
      !('agent_id' in payload)
    );
  }

  /**
   * Type guard for DispatchAgentAssignmentCommand.
   */
  private isAgentAssignmentCommand(
    payload: DispatchCommandPayload,
  ): payload is DispatchAgentAssignmentCommand {
    return 'agent_id' in payload;
  }

  /**
   * Extract distance, duration, and geometry from an OSRM route response.
   */
  private extractRouteSummary(response: any): {
    distance: number;
    duration: number;
    geometry: unknown;
  } {
    const route = response?.routes?.[0];
    if (!route) {
      logger.warn('OSRM route response missing route data', { response });
      return { distance: 0, duration: 0, geometry: null };
    }

    return {
      distance: Math.round(route.distance),
      duration: Math.round(route.duration),
      geometry: route.geometry,
    };
  }

  /* Getting the nearby delivery agents using GEO SEARCH */
  private async getNearbyDeliveryAgents({
    restaurantCoords,
  }: {
    restaurantCoords: { longitude: number; latitude: number };
  }) {
    let nearbyAgents: GeoSearchResult<{
      withDist: true;
      withCoord: true;
      count: number;
      sort: 'ASC';
    }>[] = [];

    nearbyAgents = await this.cacheService.geoSearch(
      'location:delivery-agents',
      {
        longitude: restaurantCoords.longitude,
        latitude: restaurantCoords.latitude,
      },
      2,
      'km',
      { withDist: true, withCoord: true, count: 15, sort: 'ASC' },
    );

    if (nearbyAgents.length === 0) {
      nearbyAgents = await this.cacheService.geoSearch(
        'location:delivery-agents',
        {
          longitude: restaurantCoords.longitude,
          latitude: restaurantCoords.latitude,
        },
        5,
        'km',
        { withDist: true, withCoord: true, count: 15, sort: 'ASC' },
      );

      if (nearbyAgents.length === 0) {
        nearbyAgents = await this.cacheService.geoSearch(
          'location:delivery-agents',
          {
            longitude: restaurantCoords.longitude,
            latitude: restaurantCoords.latitude,
          },
          7,
          'km',
          { withDist: true, withCoord: true, count: 15, sort: 'ASC' },
        );

        if (nearbyAgents.length === 0) {
          /* Publish event for cancelling the order due to DA unavailability */

          logger.info(
            'Delivery agents unavailable for order dispatch. Emitting for cancelling the order',
            {
              restaurantCoords,
            },
          );
        }
      }
    }

    logger.info('Available delivery agents', {
      restaurantCoords,
      deliveryAgentsCount: nearbyAgents.length,
    });

    return nearbyAgents;
  }
}

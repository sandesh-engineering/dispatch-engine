import { randomUUID } from 'crypto';
import { logger } from '@platform/logger';
import { withSpan, trace, context } from '@platform/tracing';
import { ContextPropagation } from 'src/tracing/propagation/context';
import {
  DISPATCH_COMMANDS,
  DISPATCH_EVENTS,
  DISPATCH_EXCHANGE,
  DispatchCreateCommand,
  DispatchAgentSelectionCommand,
  DispatchAgentAssignmentCommand,
  AgentNotifiedEvent,
  AgentAssignedEvent,
  DispatchCommandPayload,
  DispatchCreatedEvent,
} from '../types/events';
import { IEventBus } from 'src/interfaces/event-bus.interface';
import { ICacheService } from '@platform/cache';
import { EtaService } from '../services/eta-base.service';
import { DispatchRepository } from 'src/repositories/dispatch.repository';
import { DispatchCandidatesRepository } from 'src/repositories/dispatch-candidates.repository';
import { DispatchConfigService } from 'src/services/dispatch-config.service';
import { DispatchStatus } from 'src/entities/dispatch.entity';
import { CandidateOfferStatus } from 'src/entities/dispatch-candidate.entity';

const DISPATCH_CONSUMER_QUEUE = 'dispatch-engine.commands.queue';

export class DispatchCommandQueue {
  private provisioned = false;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly etaService: EtaService,
    private readonly cacheService: ICacheService,
    private readonly dispatchRepo: DispatchRepository,
    private readonly candidatesRepo: DispatchCandidatesRepository,
    private readonly configService: DispatchConfigService,
  ) { }

  async provision(): Promise<void> {
    if (this.provisioned) {
      logger.warn('DispatchCommandQueue already provisioned — skipping');
      return;
    }

    logger.info('Provisioning DispatchCommandQueue...');
    await this.eventBus.connect();

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

  private async handleCommand(
    payload: DispatchCommandPayload,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    const parentContext = ContextPropagation.extractContext(
      (headers?.trace as Record<string, unknown>) ?? {},
    );

    return withSpan(
      'Dispatch Handle Command',
      async () => {
        logger.info('Processing dispatch command', {
          type: this.resolveCommandType(payload),
          order_id: (payload as DispatchCreateCommand).order_id,
        });

        if (this.isCreateCommand(payload)) {
          await this.handleCreateCommand(payload);
        } else if (this.isAgentSelectionCommand(payload)) {
          await this.handleAgentSelectionCommand(payload);
        } else if (this.isAgentAssignmentCommand(payload)) {
          await this.handleAgentAssignmentCommand(payload);
        } else {
          logger.warn('Unknown dispatch command payload', { payload });
        }
      },
      parentContext,
    );
  }

  private async handleCreateCommand(
    payload: DispatchCreateCommand,
  ): Promise<void> {
    const restaurantCoords = {
      longitude: payload.restaurant_coords.longitude,
      latitude: payload.restaurant_coords.latitude,
    };

    const customerCoords = {
      longitude: payload.customer_coords.longitude,
      latitude: payload.customer_coords.latitude,
    };

    const { dispatch, candidates } = await this.etaService.calculateForDispatch(
      restaurantCoords,
      customerCoords,
      payload.order_id,
      payload.restaurant_id,
    );

    const activeSpan = trace.getSpan(context.active());
    activeSpan?.setAttributes({
      'dispatch.order_id': payload.order_id,
      'dispatch.id': dispatch.id,
      'dispatch.candidate_count': candidates.length,
      'dispatch.batch_number': dispatch.currentBatch,
    });

    if (candidates.length === 0) {
      logger.warn('No eligible candidates found — dispatch creation rejected', {
        order_id: payload.order_id,
        dispatch_id: dispatch.id,
      });

      await this.eventBus.publish(DISPATCH_EVENTS.CREATION_REJECTED, {
        order_id: payload.order_id,
        reason: 'NO_ELIGIBLE_AGENTS',
        rejected_at: new Date().toISOString(),
      });

      return;
    }

    /* Transition status: SEARCHING → OFFERING */
    await this.dispatchRepo.updateStatus(
      dispatch.id,
      DispatchStatus.SEARCHING,
      DispatchStatus.OFFERING,
      { currentBatch: 1 },
    );

    const runtimeConfig = await this.configService.getConfig();

    /* Select batch 1 candidates & batch-update DB (no N+1) */
    const firstBatchCandidates = candidates.slice(0, runtimeConfig.batchSize);
    const firstBatchDriverIds = firstBatchCandidates.map((c) => c.agent.id);

    await this.candidatesRepo.updateBatchOfferStatus(
      dispatch.id,
      firstBatchDriverIds,
      1,
      CandidateOfferStatus.OFFERED,
      { offeredAt: new Date() },
    );

    const primaryCandidate = firstBatchCandidates[0];

    const event: DispatchCreatedEvent = {
      dispatch_id: dispatch.id,
      order_id: payload.order_id,
      agent_to_restaurant: {
        distance_meters: primaryCandidate
          ? primaryCandidate.agentToRestaurant.distanceMeters
          : 0,
        duration_seconds: primaryCandidate
          ? primaryCandidate.agentToRestaurant.durationSeconds
          : 0,
        polyline: primaryCandidate?.agentToRestaurant.geometry ?? '',
      },
      restaurant_to_customer: {
        distance_meters: primaryCandidate
          ? primaryCandidate.restaurantToCustomer.distanceMeters
          : 0,
        duration_seconds: primaryCandidate
          ? primaryCandidate.restaurantToCustomer.durationSeconds
          : 0,
        polyline: primaryCandidate?.restaurantToCustomer.geometry ?? '',
      },
      total_eta_seconds: primaryCandidate ? primaryCandidate.totalEtaSeconds : 0,
      created_at: new Date().toISOString(),
    };

    await this.eventBus.publish(DISPATCH_EVENTS.CREATED, event);

    logger.info('Published dispatch.v1.created', {
      dispatch_id: dispatch.id,
      order_id: payload.order_id,
      total_eta_seconds: event.total_eta_seconds,
      batch_candidates_offered: firstBatchCandidates.length,
    });
  }

  private async handleAgentSelectionCommand(
    payload: DispatchAgentSelectionCommand,
  ): Promise<void> {
    const event: AgentNotifiedEvent = {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
      agent_id: 'pending',
      notified_at: new Date().toISOString(),
    };

    await this.eventBus.publish(DISPATCH_EVENTS.AGENT_NOTIFIED, event);

    logger.info('Published agent.v1.notified', {
      dispatch_id: payload.dispatch_id,
      order_id: payload.order_id,
    });
  }

  private async handleAgentAssignmentCommand(
    payload: DispatchAgentAssignmentCommand,
  ): Promise<void> {
    /* Idempotent transition: OFFERING/SEARCHING → ASSIGNED */
    const updated = await this.dispatchRepo.updateStatus(
      payload.dispatch_id,
      [DispatchStatus.OFFERING, DispatchStatus.SEARCHING],
      DispatchStatus.ASSIGNED,
      {
        assignedDriverId: payload.agent_id,
        assignedAt: new Date(),
      },
    );

    if (!updated) {
      logger.info(
        'Assignment already processed or dispatch not in OFFERING/SEARCHING status — skipping',
        {
          dispatch_id: payload.dispatch_id,
          agent_id: payload.agent_id,
        },
      );
      return;
    }

    await this.candidatesRepo.updateOfferStatus(
      payload.dispatch_id,
      payload.agent_id,
      1,
      CandidateOfferStatus.ACCEPTED,
      { respondedAt: new Date() },
    );

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

  private resolveCommandType(payload: DispatchCommandPayload): string {
    if (this.isCreateCommand(payload)) return DISPATCH_COMMANDS.REQUEST_CREATION;
    if (this.isAgentSelectionCommand(payload))
      return DISPATCH_COMMANDS.REQUEST_AGENT_SELECTION;
    if (this.isAgentAssignmentCommand(payload))
      return DISPATCH_COMMANDS.CONFIRM_AGENT_ASSIGNMENT;
    return 'unknown';
  }

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

  private isAgentAssignmentCommand(
    payload: DispatchCommandPayload,
  ): payload is DispatchAgentAssignmentCommand {
    return 'agent_id' in payload;
  }
}

import { logger } from '@platform/logger';
import { IRouteResolutionRouter } from '../interfaces/router.interface';
import { Coordinates, EligibleAgent } from 'src/modules/candidate-discovery';
import { RouteCandidate, RouteSummary } from '../types/route-discovery.type';

export class AgentRouteCalculator {
  constructor(private readonly router: IRouteResolutionRouter) {}

  /**
   * Calculate route information for eligible delivery agents.
   *
   * @remarks
   * - Calculates routes for all eligible agents concurrently.
   * - Each agent-to-restaurant and restaurant-to-customer route is already
   *   resolved concurrently by the routing provider.
   * - A failed agent route does not fail the entire candidate batch.
   *
   * @param {EligibleAgent[]} agents - Eligible delivery agents.
   * @param {Coordinates} restaurantCoords - Restaurant coordinates.
   * @param {Coordinates} customerCoords - Customer coordinates.
   * @returns {Promise<RouteCandidate[]>} Successfully calculated route candidates.
   *
   * @example
   * ```ts
   * const candidates = await routeCalculator.calculate(
   *   eligibleAgents,
   *   restaurantCoords,
   *   customerCoords,
   * );
   * ```
   */
  async calculate(
    agents: EligibleAgent[],
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<RouteCandidate[]> {
    const results = await Promise.allSettled(
      agents.map((agent) =>
        this.calculateForAgent(agent, restaurantCoords, customerCoords),
      ),
    );

    return results.flatMap((result) => {
      if (result.status === 'rejected') {
        logger.warn('Failed to calculate routes for delivery agent', {
          reason: result.reason,
        });

        return [];
      }

      return [result.value];
    });
  }

  /**
   * Calculate both route segments for a single delivery agent.
   *
   * @remarks
   * - The routing provider calculates agent-to-restaurant and
   *   restaurant-to-customer routes concurrently.
   * - The resulting routes remain associated with the delivery agent.
   *
   * @param {EligibleAgent} agent - Delivery agent requiring route calculation.
   * @param {Coordinates} restaurantCoords - Restaurant coordinates.
   * @param {Coordinates} customerCoords - Customer coordinates.
   * @returns {Promise<RouteCandidate>} Normalized route candidate.
   *
   * @example
   * ```ts
   * const candidate =
   *   await this.calculateForAgent(
   *     agent,
   *     restaurantCoords,
   *     customerCoords,
   *   );
   * ```
   */
  private async calculateForAgent(
    agent: EligibleAgent,
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<RouteCandidate> {
    const routes = await this.router.getRoutes({
      restaurantCoords,
      customerCoords,
      deliveryAgentCoords: agent.coordinates,
    });

    const agentToRestaurant = this.extractRouteSummary(
      routes.agentToRestaurantResponse,
    );

    const restaurantToCustomer = this.extractRouteSummary(
      routes.restaurantToCustomerResponse,
    );

    return {
      agent,
      agentToRestaurant,
      restaurantToCustomer,
      totalEtaSeconds:
        agentToRestaurant.durationSeconds +
        restaurantToCustomer.durationSeconds,
    };
  }

  /**
   * Extract the primary route summary from an OSRM response.
   *
   * @remarks
   * - OSRM returns route information inside the `routes` array.
   * - The first route is used as the primary route.
   * - Only normalized route information is exposed to the dispatch layer.
   *
   * @param {unknown} response - Raw OSRM route response.
   * @returns {RouteSummary} Normalized route summary.
   * @throws {Error} Throws an Error when the OSRM response does not contain a valid route.
   *
   * @example
   * ```ts
   * const summary =
   *   this.extractRouteSummary(osrmResponse);
   * ```
   */
  private extractRouteSummary(response: unknown): RouteSummary {
    if (!this.isValidOsrmResponse(response)) {
      throw new Error('Invalid OSRM route response');
    }

    const route = response.routes[0];

    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
    };
  }

  /**
   * Validate the minimum OSRM response structure required by the calculator.
   *
   * @remarks
   * - This is intentionally limited to fields required by route extraction.
   *
   * @param {unknown} response - Raw routing provider response.
   * @returns {boolean} Whether the response contains a usable route.
   *
   * @example
   * ```ts
   * if (this.isValidOsrmResponse(response)) {
   *   // Response contains a usable route.
   * }
   * ```
   */
  private isValidOsrmResponse(response: unknown): response is {
    code: string;
    routes: Array<{
      distance: number;
      duration: number;
      geometry: unknown;
    }>;
  } {
    if (typeof response !== 'object' || response === null) {
      return false;
    }

    const value = response as {
      code?: unknown;
      routes?: unknown;
    };

    if (
      value.code !== 'Ok' ||
      !Array.isArray(value.routes) ||
      value.routes.length === 0
    ) {
      return false;
    }

    const route = value.routes[0];

    if (typeof route !== 'object' || route === null) {
      return false;
    }

    const candidate = route as {
      distance?: unknown;
      duration?: unknown;
      geometry?: unknown;
    };

    return (
      typeof candidate.distance === 'number' &&
      typeof candidate.duration === 'number' &&
      candidate.geometry !== undefined
    );
  }
}

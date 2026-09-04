import axios from 'axios';
import CircuitBreaker from 'opossum';
import { logger } from '@platform/logger';
import {
  IOsrmClient,
  IRouteMatrixResolver,
  IRouteResolutionRouter,
  RouteMatrix,
  TravelEstimate,
} from '../../route-discovery/interfaces/router.interface';
import { RankableAgent } from 'src/modules/ranking';
import { Coordinates } from 'src/modules/candidate-discovery';

// /**
//  * OSRM API base URL — can be swapped to a self-hosted instance or a
//  * different routing provider that implements the same HTTP contract.
//  */
// const OSRM_BASE_URL = 'https://router.project-osrm.org';

// /**
//  * Circuit breaker configuration (mock thresholds — tune in production):
//  *
//  * - `timeout`:      5_000 ms — each OSRM HTTP call must complete within 5s.
//  * - `errorThresholdPercentage`: 50 — open the circuit when ≥50% of requests fail.
//  * - `resetTimeout`: 30_000 ms — after opening, wait 30s before allowing a probe.
//  * - `rollingCountTimeout`: 10_000 ms — statistics window for failure counting.
//  * - `rollingCountBuckets`: 10 — number of buckets in the rolling window.
//  *
//  * Why opossum?
//  * - Minimal, battle-tested circuit breaker for Node.js (used at Netflix scale).
//  * - Provides bulkheading: a failing OSRM provider won't cascade into the dispatch engine.
//  * - Publishes state-change events (`open`, `close`, `halfOpen`) for observability.
//  * - Pairs naturally with a fallback response when the circuit is open.
//  */
// const CIRCUIT_BREAKER_OPTIONS: CircuitBreaker.Options = {
//   timeout: 5_000,
//   errorThresholdPercentage: 50,
//   resetTimeout: 30_000,
//   rollingCountTimeout: 10_000,
//   rollingCountBuckets: 10,
//   name: 'osrm-router',
// };

// /**
//  * Shape of a resolved OSRM route call.
//  */
// interface OsrmRouteResult {
//   agentToRestaurantResponse: unknown;
//   restaurantToCustomerResponse: unknown;
// }

interface OsrmTableResponse {
  code: string;
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

/**
 * OSRM route resolver with circuit breaker protection.
 *
 * The `IRouteResolutionRouter` interface abstracts the routing provider so
 * that the dispatch engine can switch between OSRM, Google Maps Routes API,
 * GraphHopper, or any other provider without changing the command queue logic.
 *
 * To swap providers:
 * 1. Create a new class implementing `IRouteResolutionRouter`
 * 2. Inject it into `DispatchCommandQueue` via the constructor
 */
// export class OsrmRouter implements IRouteResolutionRouter {
//   private readonly breaker: CircuitBreaker;

//   constructor() {
//     /* Wrap the route-fetching function with opossum */
//     this.breaker = new CircuitBreaker(
//       this.fetchRoutes.bind(this),
//       CIRCUIT_BREAKER_OPTIONS,
//     );

//     /* Wire up circuit breaker logging events */
//     this.breaker.on('open', () =>
//       logger.warn(
//         'Circuit breaker OPEN — OSRM requests will be short-circuited',
//       ),
//     );
//     this.breaker.on('close', () =>
//       logger.info('Circuit breaker CLOSED — OSRM requests resumed'),
//     );
//     this.breaker.on('halfOpen', () =>
//       logger.info('Circuit breaker HALF_OPEN — probing OSRM'),
//     );

//     /* When the circuit is open or a timeout occurs, use the fallback */
//     this.breaker.fallback(() => this.buildFallbackResponse());
//   }

//   async getRoutes(params: {
//     restaurantCoords: { longitude: number; latitude: number };
//     customerCoords: { longitude: number; latitude: number };
//     deliveryAgentCoords: { longitude: number; latitude: number };
//   }): Promise<OsrmRouteResult> {
//     return this.breaker.fire(params);
//   }

//   /**
//    * Actual HTTP calls to OSRM.
//    * Broken out as a separate method so the circuit breaker can wrap it cleanly.
//    */
//   private async fetchRoutes(params: {
//     restaurantCoords: { longitude: number; latitude: number };
//     customerCoords: { longitude: number; latitude: number };
//     deliveryAgentCoords: { longitude: number; latitude: number };
//   }): Promise<OsrmRouteResult> {
//     const { deliveryAgentCoords, restaurantCoords, customerCoords } = params;

//     const agentToRestaurantUrl = `${OSRM_BASE_URL}/route/v1/driving/${deliveryAgentCoords.longitude},${deliveryAgentCoords.latitude};${restaurantCoords.longitude},${restaurantCoords.latitude}?alternatives=true`;

//     const restaurantToCustomerUrl = `${OSRM_BASE_URL}/route/v1/driving/${restaurantCoords.longitude},${restaurantCoords.latitude};${customerCoords.longitude},${customerCoords.latitude}?alternatives=true`;

//     const [agentToRestaurantResponse, restaurantToCustomerResponse] =
//       await Promise.all([
//         axios.get(agentToRestaurantUrl, {
//           params: { overview: 'full', geometries: 'geojson', steps: true },
//         }),
//         axios.get(restaurantToCustomerUrl, {
//           params: { overview: 'full', geometries: 'geojson', steps: true },
//         }),
//       ]);

//     return {
//       agentToRestaurantResponse: agentToRestaurantResponse.data,
//       restaurantToCustomerResponse: restaurantToCustomerResponse.data,
//     };
//   }

//   /**
//    * Fallback response when the circuit is open or the request times out.
//    * Returns zeroed-out shape so the saga can still advance with degraded data.
//    */
//   private buildFallbackResponse(): OsrmRouteResult {
//     logger.warn(
//       'OSRM circuit breaker fallback — returning degraded route data',
//     );

//     const fallbackRoute = {
//       code: 'DegradedService',
//       routes: [
//         {
//           distance: 0,
//           duration: 0,
//           geometry: { type: 'LineString', coordinates: [] },
//         },
//       ],
//     };

//     return {
//       agentToRestaurantResponse: fallbackRoute,
//       restaurantToCustomerResponse: fallbackRoute,
//     };
//   }
// }

/**
 * Resolves travel distance and duration for a batch of delivery agents
 * using the OSRM Table service.
 *
 * @remarks
 * - Uses one OSRM Table request for the entire candidate batch.
 * - Resolves delivery-agent-to-restaurant estimates and the shared
 *   restaurant-to-customer estimate.
 * - Provider-specific OSRM response structures are normalized before
 *   being returned to the ETA domain.
 * - This resolver does not perform ranking, eligibility filtering,
 *   ETA threshold filtering, or route geometry calculation.
 *
 * @param {RankableAgent[]} agents - Ranked delivery agents requiring
 * route estimates.
 * @param {Coordinates} restaurantCoords - Restaurant coordinates.
 * @param {Coordinates} customerCoords - Customer coordinates.
 * @returns {Promise<RouteMatrix>} Normalized travel estimates for the
 * provided agents.
 * @throws {Error} Throws an `Error` when the OSRM response is invalid
 * or a required travel estimate is unavailable.
 *
 * @example
 * ```ts
 * const matrix = await routeMatrixResolver.resolve(
 *   agents,
 *   restaurantCoords,
 *   customerCoords,
 * );
 * ```
 */
export class OsrmTableResolver implements IRouteMatrixResolver {
  constructor(private readonly osrmClient: IOsrmClient) {}

  async resolve(
    agents: RankableAgent[],
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<RouteMatrix> {
    const coordinates = [
      ...agents.map((agent) => agent?.coordinates),
      restaurantCoords,
      customerCoords,
    ];

    const restaurantIndex = agents.length;
    const customerIndex = agents.length + 1;

    const sources = [...agents.map((_, index) => index), restaurantIndex];

    const destinations = [restaurantIndex, customerIndex];

    const response = await this.osrmClient.table({
      coordinates,
      sources,
      destinations,
    });

    const table = this.validateResponse(response);

    const restaurantToCustomer = this.extractEstimate(table, agents.length, 1);

    const agentEstimates = agents.map((agent, index) => ({
      agentId: agent.id,
      agentToRestaurant: this.extractEstimate(table, index, 0),
    }));

    logger.info('Route matrix agent estimates', {
      agent_estimates_count: agentEstimates.length,
    });

    return {
      restaurantToCustomer,
      agents: agentEstimates,
    };
  }

  /**
   * Extract a travel estimate from an OSRM Table response.
   *
   * @remarks
   * - Matrix indexes correspond to the positions of the source and
   * destination entries supplied to OSRM.
   * - A null duration or distance means OSRM could not resolve that pair.
   *
   * @param {OsrmTableResponse} response - Validated OSRM Table response.
   * @param {number} sourceIndex - Source position in the OSRM response matrix.
   * @param {number} destinationIndex - Destination position in the OSRM
   * response matrix.
   * @returns {TravelEstimate} Normalized distance and duration.
   * @throws {Error} Throws an `Error` when distance or duration is unavailable.
   *
   * @example
   * ```ts
   * const estimate = this.extractEstimate(response, 0, 0);
   * ```
   */
  private extractEstimate(
    response: OsrmTableResponse,
    sourceIndex: number,
    destinationIndex: number,
  ): TravelEstimate {
    const duration = response.durations?.[sourceIndex]?.[destinationIndex];

    const distance = response.distances?.[sourceIndex]?.[destinationIndex];

    if (duration == null || distance == null) {
      logger.error(
        `Missing OSRM travel estimate at [${sourceIndex}][${destinationIndex}]`,
      );
      throw new Error(
        `Missing OSRM travel estimate at [${sourceIndex}][${destinationIndex}]`,
      );
    }

    return {
      durationSeconds: duration,
      distanceMeters: distance,
    };
  }

  /**
   * Validate the minimum OSRM Table response structure required by
   * the resolver.
   *
   * @remarks
   * - Validation is intentionally limited to fields required by the
   * domain mapping.
   * - Raw OSRM response validation remains inside the OSRM adapter.
   *
   * @param {unknown} response - Raw OSRM Table response.
   * @returns {OsrmTableResponse} Validated OSRM Table response.
   * @throws {Error} Throws an `Error` when the response does not contain
   * a usable OSRM Table response.
   *
   * @example
   * ```ts
   * const table = this.validateResponse(response);
   * ```
   */
  private validateResponse(response: unknown): OsrmTableResponse {
    if (typeof response !== 'object' || response === null) {
      logger.error('Invalid OSRM Table response', { response });
      throw new Error('Invalid OSRM Table response');
    }

    const value = response as {
      code?: unknown;
      durations?: unknown;
      distances?: unknown;
    };

    if (value.code !== 'Ok') {
      logger.error(
        `OSRM Table request failed with code: ${String(value.code)}`,
      );
      throw new Error(
        `OSRM Table request failed with code: ${String(value.code)}`,
      );
    }

    if (!Array.isArray(value.durations) || !Array.isArray(value.distances)) {
      logger.error(
        'OSRM Table response does not contain durations and distances',
      );
      throw new Error(
        'OSRM Table response does not contain durations and distances',
      );
    }

    return value as OsrmTableResponse;
  }
}

import axios from 'axios';
import CircuitBreaker from 'opossum';
import { logger } from '@platform/logger';
import { IRouteResolutionRouter } from '../interfaces/router.interface';

/**
 * OSRM API base URL — can be swapped to a self-hosted instance or a
 * different routing provider that implements the same HTTP contract.
 */
const OSRM_BASE_URL = 'https://router.project-osrm.org';

/**
 * Circuit breaker configuration (mock thresholds — tune in production):
 *
 * - `timeout`:      5_000 ms — each OSRM HTTP call must complete within 5s.
 * - `errorThresholdPercentage`: 50 — open the circuit when ≥50% of requests fail.
 * - `resetTimeout`: 30_000 ms — after opening, wait 30s before allowing a probe.
 * - `rollingCountTimeout`: 10_000 ms — statistics window for failure counting.
 * - `rollingCountBuckets`: 10 — number of buckets in the rolling window.
 *
 * Why opossum?
 * - Minimal, battle-tested circuit breaker for Node.js (used at Netflix scale).
 * - Provides bulkheading: a failing OSRM provider won't cascade into the dispatch engine.
 * - Publishes state-change events (`open`, `close`, `halfOpen`) for observability.
 * - Pairs naturally with a fallback response when the circuit is open.
 */
const CIRCUIT_BREAKER_OPTIONS: CircuitBreaker.Options = {
  timeout: 5_000,
  errorThresholdPercentage: 50,
  resetTimeout: 30_000,
  rollingCountTimeout: 10_000,
  rollingCountBuckets: 10,
  name: 'osrm-router',
};

/**
 * Shape of a resolved OSRM route call.
 */
interface OsrmRouteResult {
  agentToRestaurantResponse: unknown;
  restaurantToCustomerResponse: unknown;
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
export class OsrmRouter implements IRouteResolutionRouter {
  private readonly breaker: CircuitBreaker;

  constructor() {
    /* Wrap the route-fetching function with opossum */
    this.breaker = new CircuitBreaker(
      this.fetchRoutes.bind(this),
      CIRCUIT_BREAKER_OPTIONS,
    );

    /* Wire up circuit breaker logging events */
    this.breaker.on('open', () =>
      logger.warn(
        'Circuit breaker OPEN — OSRM requests will be short-circuited',
      ),
    );
    this.breaker.on('close', () =>
      logger.info('Circuit breaker CLOSED — OSRM requests resumed'),
    );
    this.breaker.on('halfOpen', () =>
      logger.info('Circuit breaker HALF_OPEN — probing OSRM'),
    );

    /* When the circuit is open or a timeout occurs, use the fallback */
    this.breaker.fallback(() => this.buildFallbackResponse());
  }

  async getRoutes(params: {
    restaurantCoords: { longitude: number; latitude: number };
    customerCoords: { longitude: number; latitude: number };
    deliveryAgentCoords: { longitude: number; latitude: number };
  }): Promise<OsrmRouteResult> {
    return this.breaker.fire(params);
  }

  /**
   * Actual HTTP calls to OSRM.
   * Broken out as a separate method so the circuit breaker can wrap it cleanly.
   */
  private async fetchRoutes(params: {
    restaurantCoords: { longitude: number; latitude: number };
    customerCoords: { longitude: number; latitude: number };
    deliveryAgentCoords: { longitude: number; latitude: number };
  }): Promise<OsrmRouteResult> {
    const { deliveryAgentCoords, restaurantCoords, customerCoords } = params;

    const agentToRestaurantUrl = `${OSRM_BASE_URL}/route/v1/driving/${deliveryAgentCoords.longitude},${deliveryAgentCoords.latitude};${restaurantCoords.longitude},${restaurantCoords.latitude}?alternatives=true`;

    const restaurantToCustomerUrl = `${OSRM_BASE_URL}/route/v1/driving/${restaurantCoords.longitude},${restaurantCoords.latitude};${customerCoords.longitude},${customerCoords.latitude}?alternatives=true`;

    const [agentToRestaurantResponse, restaurantToCustomerResponse] =
      await Promise.all([
        axios.get(agentToRestaurantUrl, {
          params: { overview: 'full', geometries: 'geojson', steps: true },
        }),
        axios.get(restaurantToCustomerUrl, {
          params: { overview: 'full', geometries: 'geojson', steps: true },
        }),
      ]);

    return {
      agentToRestaurantResponse: agentToRestaurantResponse.data,
      restaurantToCustomerResponse: restaurantToCustomerResponse.data,
    };
  }

  /**
   * Fallback response when the circuit is open or the request times out.
   * Returns zeroed-out shape so the saga can still advance with degraded data.
   */
  private buildFallbackResponse(): OsrmRouteResult {
    logger.warn(
      'OSRM circuit breaker fallback — returning degraded route data',
    );

    const fallbackRoute = {
      code: 'DegradedService',
      routes: [
        {
          distance: 0,
          duration: 0,
          geometry: { type: 'LineString', coordinates: [] },
        },
      ],
    };

    return {
      agentToRestaurantResponse: fallbackRoute,
      restaurantToCustomerResponse: fallbackRoute,
    };
  }
}

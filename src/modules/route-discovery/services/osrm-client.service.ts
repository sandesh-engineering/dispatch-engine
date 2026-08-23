import axios from 'axios';
import CircuitBreaker from 'opossum';
import { logger } from '@platform/logger';
import { IOsrmClient } from '../../route-discovery/interfaces/router.interface';
import { Coordinates } from 'src/modules/candidate-discovery';

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

export class OsrmClient implements IOsrmClient {
  private readonly breaker: CircuitBreaker;

  constructor() {
    this.breaker = new CircuitBreaker(
      this.fetchTable.bind(this),
      CIRCUIT_BREAKER_OPTIONS,
    );

    this.breaker.on('open', () => {
      logger.warn(
        'Circuit breaker OPEN — OSRM Table requests will be short-circuited',
      );
    });

    this.breaker.on('close', () => {
      logger.info('Circuit breaker CLOSED — OSRM Table requests resumed');
    });

    this.breaker.on('halfOpen', () => {
      logger.info('Circuit breaker HALF_OPEN — probing OSRM Table');
    });
  }

  /**
   * Resolve a travel-time and distance matrix using OSRM Table.
   *
   * @remarks
   * - Sends one Table request for the supplied source and destination
   * coordinates.
   * - The circuit breaker protects the dispatch engine from repeated
   * OSRM failures.
   *
   * @param {Object} params - Table request parameters.
   * @param {Coordinates[]} params.coordinates - Coordinates referenced
   * by the source and destination indexes.
   * @param {number[]} params.sources - Source coordinate indexes.
   * @param {number[]} params.destinations - Destination coordinate indexes.
   * @returns {Promise<unknown>} Raw OSRM Table response.
   * @throws {Error} Throws when the OSRM request fails.
   *
   * @example
   * ```ts
   * const response = await client.table({
   *   coordinates,
   *   sources,
   *   destinations,
   * });
   * ```
   */
  async table(params: {
    coordinates: Coordinates[];
    sources: number[];
    destinations: number[];
  }): Promise<unknown> {
    return this.breaker.fire(params);
  }

  /**
   * Perform the HTTP request against the OSRM Table service.
   *
   * @remarks
   * - This method is intentionally private so the public client exposes
   * a provider-independent operation.
   *
   * @param {Object} params - OSRM Table request parameters.
   * @returns {Promise<unknown>} Raw OSRM Table response.
   * @throws {Error} Throws when the HTTP request fails.
   *
   * @example
   * ```ts
   * const response = await this.fetchTable({
   *   coordinates,
   *   sources,
   *   destinations,
   * });
   * ```
   */
  private async fetchTable(params: {
    coordinates: Coordinates[];
    sources: number[];
    destinations: number[];
  }): Promise<unknown> {
    const { coordinates, sources, destinations } = params;

    const coordinatePath = coordinates
      .map(({ longitude, latitude }) => `${longitude},${latitude}`)
      .join(';');

    const response = await axios.get(
      `${OSRM_BASE_URL}/table/v1/driving/${coordinatePath}`,
      {
        params: {
          sources: sources.join(';'),
          destinations: destinations.join(';'),
          annotations: 'duration,distance',
        },
      },
    );

    return response.data;
  }
}

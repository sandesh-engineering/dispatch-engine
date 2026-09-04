import { Route } from '../types/eta.types';
import { IDriverMetricsProvider } from './driver.service';

export interface ETAAdjustment {
  source: 'TRAFFIC' | 'WEATHER' | 'RESTAURANT' | 'DRIVER' | 'HISTORICAL';

  delaySeconds: number;

  confidence: number;

  metadata?: Record<string, unknown>;
}

export interface EtaAggregationInput {
  driverId: string;
  route: Route;
}

export interface EtaAggregationResult {
  baseEtaSeconds: number;
  adjustments: ETAAdjustment[];
  finalEtaSeconds: number;
}

export class EtaAggregatorService {
  constructor(private readonly driverMetricsProvider: IDriverMetricsProvider) {}

  /**
   * Aggregates the base route ETA with available ETA adjustments.
   *
   * @remarks
   * - The OSRM route duration is treated as the base ETA.
   * - Driver-specific metrics are currently the only adjustment source.
   * - Additional providers such as traffic, weather, restaurant, and
   *   historical ETA can be added without changing the public API.
   *
   * @param {EtaAggregationInput} input - Driver and route information.
   * @returns {Promise<EtaAggregationResult>} Aggregated ETA result.
   *
   * @example
   * ```ts
   * const result = await etaAggregator.aggregate({
   *   driverId: 'driver-123',
   *   route,
   * });
   * ```
   */
  async aggregate(input: EtaAggregationInput): Promise<EtaAggregationResult> {
    const { driverId, route } = input;

    const baseEtaSeconds = route.durationSeconds;

    const driverAdjustment = await this.calculateDriverAdjustment(
      driverId,
      route,
    );

    const adjustments = driverAdjustment ? [driverAdjustment] : [];

    const finalEtaSeconds =
      baseEtaSeconds +
      adjustments.reduce(
        (total, adjustment) => total + adjustment.delaySeconds,
        0,
      );

    return {
      baseEtaSeconds,
      adjustments,
      finalEtaSeconds,
    };
  }

  /**
   * Calculates the ETA adjustment caused by driver-specific characteristics.
   *
   * @remarks
   * - OSRM provides a road-based travel estimate, not a driver-specific estimate.
   * - Current speed is preferred when available.
   * - Average speed is used as a fallback when current speed is unavailable.
   * - Idle duration is intentionally not directly added to ETA because idle time
   *   is not equivalent to future travel delay.
   *
   * @param {string} driverId - Delivery agent identifier.
   * @param {Route} route - Route used for the ETA calculation.
   * @returns {Promise<ETAAdjustment | null>} Driver adjustment or null when
   *   insufficient metrics are available.
   *
   * @example
   * ```ts
   * const adjustment =
   *   await this.calculateDriverAdjustment(driverId, route);
   * ```
   */
  private async calculateDriverAdjustment(
    driverId: string,
    route: Route,
  ): Promise<ETAAdjustment | null> {
    const [averageSpeed, currentSpeed] = await Promise.all([
      this.driverMetricsProvider.getAverageSpeed(driverId),
      this.driverMetricsProvider.getCurrentSpeed(driverId),
    ]);

    const effectiveSpeed = currentSpeed > 0 ? currentSpeed : averageSpeed;

    if (effectiveSpeed <= 0) {
      return null;
    }

    const driverEtaSeconds = route.distanceMeters / effectiveSpeed;

    const delaySeconds = Math.max(0, driverEtaSeconds - route.durationSeconds);

    return {
      source: 'DRIVER',
      delaySeconds,
      confidence: this.calculateConfidence(averageSpeed, currentSpeed),
      metadata: {
        averageSpeed,
        currentSpeed,
      },
    };
  }

  /**
   * Calculates confidence for the driver-specific ETA adjustment.
   *
   * @remarks
   * - Current speed provides stronger evidence than historical average speed.
   * - This is intentionally a simple heuristic for the current implementation.
   * - A calibrated confidence model can be introduced once sufficient historical
   *   data is available.
   *
   * @param {number} averageSpeed - Driver's average speed.
   * @param {number} currentSpeed - Driver's current speed.
   * @returns {number} Confidence value between 0 and 1.
   *
   * @example
   * ```ts
   * const confidence = this.calculateConfidence(
   *   averageSpeed,
   *   currentSpeed,
   * );
   * ```
   */
  private calculateConfidence(
    averageSpeed: number,
    currentSpeed: number,
  ): number {
    if (currentSpeed > 0 && averageSpeed > 0) {
      return 1;
    }

    if (averageSpeed > 0) {
      return 0.5;
    }

    return 0;
  }
}

export interface IDriverMetricsProvider {
  /**
   * Returns the driver's average observed travel speed.
   *
   * @remarks
   * - Speed is returned in meters per second.
   * - The value is derived from previously observed location updates.
   *
   * @param {string} driverId - Delivery agent identifier.
   * @returns {Promise<number>} Average speed in meters per second.
   *
   * @example
   * ```ts
   * const speed =
   *   await driverMetricsProvider.getAverageSpeed(driverId);
   * ```
   */
  getAverageSpeed(driverId: string): Promise<number>;

  /**
   * Returns the driver's most recently calculated speed.
   *
   * @remarks
   * - The value is calculated from the previous and current location.
   * - Speed is returned in meters per second.
   *
   * @param {string} driverId - Delivery agent identifier.
   * @returns {Promise<number>} Current speed in meters per second.
   *
   * @example
   * ```ts
   * const speed =
   *   await driverMetricsProvider.getCurrentSpeed(driverId);
   * ```
   */
  getCurrentSpeed(driverId: string): Promise<number>;

  /**
   * Returns how long the driver has remained effectively stationary.
   *
   * @remarks
   * - The duration is derived from consecutive location updates.
   * - Speed below the configured movement threshold is treated as idle.
   *
   * @param {string} driverId - Delivery agent identifier.
   * @returns {Promise<number>} Idle duration in seconds.
   *
   * @example
   * ```ts
   * const idleDuration =
   *   await driverMetricsProvider.getIdleDuration(driverId);
   * ```
   */
  getIdleDuration(driverId: string): Promise<number>;
}

/**
 * Road travel time (OSRM) vs Driver travel time
 * Need for these kind of optimization, since OSRM only knows the route travel time, it doesn't account for the
 */

export class DriverMetricsProvider implements IDriverMetricsProvider {
  async getAverageSpeed(driverId: string): Promise<number> {
    return 0;
  }

  async getCurrentSpeed(driverId: string): Promise<number> {
    return 0;
  }

  async getIdleDuration(driverId: string): Promise<number> {
    return 0;
  }
}

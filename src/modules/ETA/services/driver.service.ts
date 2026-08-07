export interface IDriverMetricsProvider {
  getAverageSpeed(driverId: string): Promise<number>;

  getCurrentSpeed(driverId: string): Promise<number>;

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

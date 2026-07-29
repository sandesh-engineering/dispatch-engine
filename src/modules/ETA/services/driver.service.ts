export interface IDriverMetricsProvider {
  getAverageSpeed(driverId: string): Promise<number>;

  getCurrentSpeed(driverId: string): Promise<number>;

  getIdleDuration(driverId: string): Promise<number>;
}

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

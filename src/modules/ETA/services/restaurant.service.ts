export interface IRestaurantMetricsProvider {
  getEstimatedPreparationTime(restaurantId: string): Promise<number>;

  getAverageWaitTime(restaurantId: string): Promise<number>;
}

export class RestaurantMetricsProvider implements IRestaurantMetricsProvider {
  async getEstimatedPreparationTime(restaurantId: string): Promise<number> {
    return 0;
  }

  async getAverageWaitTime(restaurantId: string): Promise<number> {
    return 0;
  }
}

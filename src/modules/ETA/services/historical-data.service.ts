import { Route } from '../types/eta.types';

export interface IHistoricalETAProvider {
  getHistoricalCorrection(route: Route, restaurantId: string): Promise<number>;
}

export class HistoricalETAProvider implements IHistoricalETAProvider {
  async getHistoricalCorrection(
    route: Route,
    restaurantId: string,
  ): Promise<number> {
    return 0;
  }
}

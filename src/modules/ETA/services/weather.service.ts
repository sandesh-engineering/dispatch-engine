import { Route } from '../types/eta.types';

export interface WeatherProvider {
  getWeatherDelay(route: Route): Promise<number>;
}

export class NoWeatherProvider implements WeatherProvider {
  async getWeatherDelay(route: Route): Promise<number> {
    return 0;
  }
}

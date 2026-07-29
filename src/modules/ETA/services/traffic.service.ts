import { Route } from '../types/eta.types';

export interface TrafficProvider {
  getTrafficDelay(route: Route): Promise<number>;
}

/* Since we don't actually have a provider that provides us this data we fallback to this methodology */
export class NoTrafficProvider implements TrafficProvider {
  async getTrafficDelay() {
    return 0;
  }
}

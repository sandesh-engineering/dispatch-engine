import { EligibleAgent } from 'src/modules/candidate-discovery';

export interface RouteSummary {
  distanceMeters: number;
  durationSeconds: number;
  geometry: unknown;
}

export interface RouteCandidate {
  agent: EligibleAgent;
  agentToRestaurant: RouteSummary;
  restaurantToCustomer: RouteSummary;
  totalEtaSeconds: number;
}

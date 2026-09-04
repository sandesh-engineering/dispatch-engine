import { RankableAgent } from 'src/modules/ranking';
import { TravelEstimate } from 'src/modules/route-discovery/interfaces/router.interface';

export interface Route {
  geometry: string;
  distanceMeters: number;
  durationSeconds: number;
}

export type CandidatesFromMatrix = {
  agent: RankableAgent;
  agentToRestaurant: TravelEstimate;
  restaurantToCustomer: TravelEstimate;
  totalDistanceMeters: number;
  totalEtaSeconds: number;
};

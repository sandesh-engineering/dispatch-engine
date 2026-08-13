import { Coordinates, EligibleAgent } from '../types/candidate-discovery.type';

export interface CandidateDiscoveryStrategy {
  discover(restaurantCoords: Coordinatess): Promise<EligibleAgent[]>;
}

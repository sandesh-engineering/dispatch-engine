import { logger } from '@platform/logger';
import {
  CandidateDiscoveryStrategy,
  Coordinates,
  EligibleAgent,
} from 'src/modules/candidate-discovery';
import {
  AgentRouteCalculator,
  IRouteResolutionRouter,
  RouteCandidate,
} from 'src/modules/route-discovery';

export interface AgentEtaResult {
  agent: EligibleAgent;
  agentToRestaurant: {
    distanceMeters: number;
    durationSeconds: number;
    geometry: unknown;
  };
  restaurantToCustomer: {
    distanceMeters: number;
    durationSeconds: number;
    geometry: unknown;
  };
  totalEtaSeconds: number;
}

export class EtaService {
  constructor(
    private readonly candidateDiscovery: CandidateDiscoveryStrategy,
    private readonly router: AgentRouteCalculator,
  ) {}

  /**
   * Discover eligible delivery agents and calculate their ETAs.
   *
   * @remarks
   * - Candidate discovery is delegated to the configured discovery strategy.
   * - Route resolution is delegated to the configured routing implementation.
   * - A failed route calculation for one agent does not fail the entire batch.
   *
   * @param {Coordinates} restaurantCoords - Restaurant coordinates.
   * @param {Coordinates} customerCoords - Customer coordinates.
   * @returns {Promise<AgentEtaResult[]>} Successfully calculated agent ETAs.
   *
   * @example
   * ```ts
   * const results = await etaService.calculateForDispatch(
   *   restaurantCoords,
   *   customerCoords,
   * );
   * ```
   */
  async calculateForDispatch(
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<RouteCandidate[]> {
    /* Getting all of the eligible delivery agents */
    const agents = await this.candidateDiscovery.discover(restaurantCoords);

    if (agents.length === 0) {
      return [];
    }

    /* Getting the routes from da-to-restaurant & restaurant-to-customer */
    const result = this.router.calculate(
      agents,
      restaurantCoords,
      customerCoords,
    );

    /**
     * The things we need to do:
     *  Calculate the ETAs based on several factors
     *  Add filtering based on the total distances that they get against the threshold distance and the threshold time
     *  Return the candidates
     */

    return result;
  }
}

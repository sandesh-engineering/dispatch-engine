import { logger } from '@platform/logger';
import {
  Coordinates,
  EligibleAgent,
  ProgressiveCandidateDiscovery,
} from 'src/modules/candidate-discovery';
import { IRouteMatrixResolver } from 'src/modules/route-discovery/interfaces/router.interface';
import { EtaConfig } from '../interfaces/eta.interface';
import { AgentRankingService, RankableAgent } from 'src/modules/ranking';
import { CandidatesFromMatrix } from '../types/eta.types';
import { EtaAggregatorService } from './eta-aggregator.service';

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
  /* NEEDS TO BE REMOVED AND DERIVED FROM THE DATA LAYER ELSE EVERY DA WILL GET THE SAME THING */
  private readonly RANKING_CONFIG = {
    weights: {
      rating: 4.2,
      cancellationRatio: 2,
      quota: 20,
      distance: 5,
    },
    maxDistanceKm: 10,
    batchSize: 50,
  };

  constructor(
    private readonly routeMatrixResolver: IRouteMatrixResolver,
    private readonly config: EtaConfig,
    private readonly etaAggregator: EtaAggregatorService,
    private readonly candidateDiscovery: ProgressiveCandidateDiscovery,
    private readonly rankingService: AgentRankingService,
  ) {}

  /**
   * Calculate route candidates for a ranked delivery-agent batch.
   *
   * @remarks
   * - Resolves all agent routes using the configured route matrix resolver.
   * - Calculates total distance and ETA for each agent.
   * - Removes candidates exceeding the configured ETA or distance thresholds.
   * - Does not perform candidate discovery, ranking, or acceptance.
   *
   * @param {RankableAgent[]} agents - Ranked delivery agents to evaluate.
   * @param {Coordinates} restaurantCoords - Restaurant coordinates.
   * @param {Coordinates} customerCoords - Customer coordinates.
   * @returns {Promise<CandidatesFromMatrix[]>} Route candidates satisfying the
   * configured ETA and distance thresholds.
   *
   * @example
   * ```ts
   * const candidates = await etaService.calculate(
   *   rankedAgents,
   *   restaurantCoords,
   *   customerCoords,
   * );
   * ```
   */
  async calculateForDispatch(
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<CandidatesFromMatrix[]> {
    /* Getting the nearby delivery agents */
    const agents = await this.candidateDiscovery.discover(restaurantCoords);

    logger.debug('Nearby delivery agents', { agents });

    if (agents.length === 0) {
      logger.warn('Missing agents list', {
        agent_count: agents.length,
      });
      return [];
    }

    /* Enhancing the delivery agents meta (Nothing since this is derived from the data layer after we integrate everything) */
    const enhancedAgentMetadata = [];

    /* Ranking the obtained candidates (Static config is used until things get in line for the command queue) */
    const rankedAgents = this.rankingService.rank(
      enhancedAgentMetadata,
      this.RANKING_CONFIG,
    );

    logger.debug('Ranked delivery agents obtained');

    /* Getting the total distance as well as time between DA to Restro as well as Restro to Customer from OSRM table matrix */
    const routeMatrix = await this.routeMatrixResolver.resolve(
      rankedAgents.nextBatch(),
      restaurantCoords,
      customerCoords,
    );

    logger.debug('Distance matrix derived', {
      agents_count: routeMatrix.agents.length,
      restaurantToCustomerDistance:
        routeMatrix.restaurantToCustomer.distanceMeters,
      restaurantToCustomerDuration:
        routeMatrix.restaurantToCustomer.durationSeconds,
    });

    /* Adding agents to map for efficient lookups */
    const agentsById = new Map<string, RankableAgent>(
      rankedAgents.nextBatch().map((agent) => [agent.id, agent]),
    );

    /* Distance from restaurant to customer */
    const restaurantToCustomer = routeMatrix.restaurantToCustomer;

    const candidates = routeMatrix.agents
      .map((agentRoute) => {
        const agent = agentsById.get(agentRoute.agentId);

        if (!agent) {
          logger.warn('No agent found in route matrix', {
            agent_id: agentRoute.agentId,
          });
          return null;
        }

        /* Total distance from agent to restro and restro to customer */
        const totalDistanceMeters =
          agentRoute.agentToRestaurant.distanceMeters +
          restaurantToCustomer.distanceMeters;

        /* Total time in seconds from agent to restro and restro to customer */
        const totalEtaSeconds =
          agentRoute.agentToRestaurant.durationSeconds +
          restaurantToCustomer.durationSeconds;

        return {
          agent,
          agentToRestaurant: agentRoute.agentToRestaurant,
          restaurantToCustomer,
          totalDistanceMeters,
          totalEtaSeconds,
        };
      })
      .filter((candidate) => candidate !== null)
      .filter((candidate) => this.isWithinThreshold(candidate));

    logger.info(
      'Route candidates satisfying the configured ETA and distance thresholds.',
      {
        eligibleCandidatesAfterThresholdCheck: candidates.length,
      },
    );

    return candidates;
  }

  /**
   * Determine whether a route candidate satisfies ETA constraints.
   *
   * @remarks
   * - A candidate must satisfy both distance and ETA limits.
   *
   * @param {CandidatesFromMatrix} candidate - Candidate being evaluated.
   * @returns {boolean} Whether the candidate satisfies configured limits.
   *
   * @example
   * ```ts
   * if (this.isWithinThreshold(candidate)) {
   *   // Candidate is viable.
   * }
   * ```
   */
  private isWithinThreshold(candidate: CandidatesFromMatrix): boolean {
    return (
      candidate.totalDistanceMeters <= this.config.maxTotalDistanceMeters &&
      candidate.totalEtaSeconds <= this.config.maxTotalEtaSeconds
    );
  }
}

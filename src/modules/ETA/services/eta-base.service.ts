import { logger } from '@platform/logger';
import {
  Coordinates,
  EligibleAgent,
  ProgressiveCandidateDiscovery,
} from 'src/modules/candidate-discovery';
import { IRouteMatrixResolver } from 'src/modules/route-discovery/interfaces/router.interface';
import { EtaConfig } from '../interfaces/eta.interface';
import { AgentRankingService, RankableAgent } from 'src/modules/ranking';
import { STATIC_RANKING_CONFIG } from 'src/modules/ranking/constants/ranking.config';
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
  constructor(
    private readonly routeMatrixResolver: IRouteMatrixResolver,
    private readonly config: EtaConfig,
    private readonly etaAggregator: EtaAggregatorService,
    private readonly candidateDiscovery: ProgressiveCandidateDiscovery,
    private readonly rankingService: AgentRankingService,
  ) {}

  /**
   * Map an EligibleAgent (from Redis GEO discovery) into a RankableAgent.
   *
   * Rating, cancellationRatio, and quota are defaulted since no driver-profile
   * data source is available in V1. Distance comes from Redis GEO.
   */
  mapToRankable(agent: EligibleAgent): RankableAgent {
    return {
      id: agent.member,
      coordinates: agent.coordinates,
      distanceKm: agent.distance,
      // Defaulted until a driver-profile data source is integrated
      rating: 4.5,
      cancellationRatio: 0.05,
      quota: { used: 0, limit: 10 },
    };
  }

  /**
   * Discover candidates and rank them.
   * Returns a RankingResult with the full ranked list; callers iterate batches.
   */
  async discoverAndRank(restaurantCoords: Coordinates) {
    /* Getting the nearby delivery agents via Redis GEO */
    const agents = await this.candidateDiscovery.discover(restaurantCoords);

    logger.debug('Nearby delivery agents', { count: agents.length });

    if (agents.length === 0) {
      return null;
    }

    /* Map EligibleAgent[] → RankableAgent[] */
    const rankableAgents: RankableAgent[] = agents.map((agent) =>
      this.mapToRankable(agent),
    );

    /* Rank using static config */
    const rankedResult = this.rankingService.rank(
      rankableAgents,
      STATIC_RANKING_CONFIG,
    );

    logger.debug('Agents ranked', {
      total: rankedResult.totalAgents,
      batchSize: STATIC_RANKING_CONFIG.batchSize,
    });

    return rankedResult;
  }

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
   */
  async calculate(
    agents: RankableAgent[],
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<CandidatesFromMatrix[]> {
    if (agents.length === 0) return [];

    /* Getting the total distance as well as time between DA to Restro as well as Restro to Customer from OSRM table matrix */
    const routeMatrix = await this.routeMatrixResolver.resolve(
      agents,
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
      agents.map((agent) => [agent.id, agent]),
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
   * Legacy convenience method: discover → rank → first batch → calculate.
   * Kept for backward compatibility. Prefer `discoverAndRank` + `calculate` separately.
   */
  async calculateForDispatch(
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
  ): Promise<CandidatesFromMatrix[]> {
    const rankedResult = await this.discoverAndRank(restaurantCoords);

    if (!rankedResult) {
      logger.warn('No agents available for dispatch', { restaurantCoords });
      return [];
    }

    const firstBatch = rankedResult.nextBatch();
    return this.calculate(firstBatch, restaurantCoords, customerCoords);
  }

  /**
   * Determine whether a route candidate satisfies ETA constraints.
   */
  private isWithinThreshold(candidate: CandidatesFromMatrix): boolean {
    return (
      candidate.totalDistanceMeters <= this.config.maxTotalDistanceMeters &&
      candidate.totalEtaSeconds <= this.config.maxTotalEtaSeconds
    );
  }
}

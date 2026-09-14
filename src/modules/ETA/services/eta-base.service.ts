import { randomUUID } from 'crypto';
import { logger } from '@platform/logger';
import { DataSource } from 'typeorm';
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
import { DispatchRepository } from 'src/repositories/dispatch.repository';
import { DispatchCandidatesRepository } from 'src/repositories/dispatch-candidates.repository';
import { DispatchConfigService } from 'src/services/dispatch-config.service';
import { DispatchEntity, DispatchStatus } from 'src/entities/dispatch.entity';
import { CandidateOfferStatus } from 'src/entities/dispatch-candidate.entity';
import { DriverMetadataResolver } from './driver-metadata.resolver';

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
    private readonly dataSource: DataSource,
    private readonly dispatchRepo: DispatchRepository,
    private readonly candidatesRepo: DispatchCandidatesRepository,
    private readonly configService: DispatchConfigService,
    private readonly driverMetadataResolver: DriverMetadataResolver,
  ) {}

  /**
   * Calculate route candidates and persist dispatch state + candidate records.
   */
  async calculate(
    agents: RankableAgent[],
    restaurantCoords: Coordinates,
    customerCoords: Coordinates,
    orderId?: string,
    restaurantId?: string,
  ): Promise<{ dispatch: DispatchEntity; candidates: CandidatesFromMatrix[] }> {
    const runtimeConfig = await this.configService.getConfig();

    const effectiveOrderId = orderId ?? `order-${randomUUID()}`;
    const effectiveRestaurantId = restaurantId ?? 'restaurant-default';

    /* Create dispatch record in SEARCHING status */
    const dispatch = await this.dispatchRepo.createDispatch({
      orderId: effectiveOrderId,
      restaurantId: effectiveRestaurantId,
      restaurantCoords,
      customerCoords,
      status: DispatchStatus.SEARCHING,
      currentBatch: 1,
      attemptCount: 1,
    });

    /* Getting nearby delivery agents from Redis */
    const agents = await this.candidateDiscovery.discover(restaurantCoords);

    logger.debug('Nearby delivery agents', { count: agents.length });

    if (agents.length === 0) {
      logger.warn('No delivery agents found nearby', { orderId: effectiveOrderId });

      dispatch.status = DispatchStatus.FAILED;
      dispatch.failureReason = 'NO_ELIGIBLE_AGENTS';
      await this.dispatchRepo.save(dispatch);

      return { dispatch, candidates: [] };
    }

    /* Dynamically resolve driver metrics from Redis or default fallback */
    const rankableAgents: RankableAgent[] = await Promise.all(
      agents.map(async (a) => {
        const meta = await this.driverMetadataResolver.resolve(a.member);
        return {
          id: a.member,
          rating: meta.rating,
          cancellationRatio: meta.cancellationRatio,
          quota: meta.quota,
          distanceKm: a.distance / 1000,
          coordinates: a.coordinates,
        };
      }),
    );

    /* Rank candidate agents using dynamic config weights */
    const rankedAgentsBatch = this.rankingService.rank(rankableAgents, {
      weights: runtimeConfig.rankingWeights,
      maxDistanceKm: runtimeConfig.maxDistanceKm,
      batchSize: runtimeConfig.candidatePoolSize,
    });

    const evaluatedAgents = rankedAgentsBatch.nextBatch();

    /* Resolve OSRM route matrix */
    const routeMatrix = await this.routeMatrixResolver.resolve(
      evaluatedAgents,
      restaurantCoords,
      customerCoords,
    );

    /* Update restaurant-to-customer shared ETA on dispatch entity */
    dispatch.restaurantToCustomerEtaSeconds = Math.round(
      routeMatrix.restaurantToCustomer.durationSeconds,
    );
    await this.dispatchRepo.save(dispatch);

    const agentsById = new Map<string, RankableAgent>(
      evaluatedAgents.map((agent) => [agent.id, agent]),
    );

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

        const totalDistanceMeters =
          agentRoute.agentToRestaurant.distanceMeters +
          restaurantToCustomer.distanceMeters;

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
      .filter((candidate): candidate is CandidatesFromMatrix => candidate !== null)
      .filter(
        (candidate) =>
          candidate.totalDistanceMeters <= runtimeConfig.maxTotalDistanceMeters &&
          candidate.totalEtaSeconds <= runtimeConfig.maxTotalEtaSeconds,
      );

    logger.info(
      'Route candidates satisfying the configured ETA and distance thresholds.',
      {
        eligibleCandidatesAfterThresholdCheck: candidates.length,
      },
    );

    /* Persist candidate records to DB */
    if (candidates.length > 0) {
      const candidateEntities = candidates.map((c, index) => ({
        dispatchId: dispatch.id,
        driverId: c.agent.id,
        batchNumber: Math.floor(index / runtimeConfig.batchSize) + 1,
        redisDistanceMeters: Math.round(c.agent.distanceKm * 1000),
        osrmDistanceMeters: c.agentToRestaurant.distanceMeters,
        osrmDurationSeconds: c.agentToRestaurant.durationSeconds,
        preEtaSeconds: c.totalEtaSeconds,
        rankingScore: null,
        offerStatus: CandidateOfferStatus.PENDING,
      }));

      await this.candidatesRepo.insertBatch(candidateEntities);
    }

    return { dispatch, candidates };
  }
}

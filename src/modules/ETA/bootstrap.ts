import { RabbitMQBus, RabbitMQBusConfig } from './events/rabbitmq.bus';
import { DispatchCommandQueue } from './events/command-queue';
import { OsrmRouter } from './router/osrm.router';
import { DISPATCH_EXCHANGE } from './types/events';
import { logger } from '@platform/logger';
import { cacheService } from 'src/utils/cache-bootstrap';
import { CacheService } from '@platform/cache';
import { DataSource } from 'typeorm';
import { EtaService } from './services/eta-base.service';
import { EtaAggregatorService } from './services/eta-aggregator.service';
import { ProgressiveCandidateDiscovery } from 'src/modules/candidate-discovery';
import { AgentRankingService, DispatchBatchStateStore } from 'src/modules/ranking';
import { DeliveryAgentScoring } from 'src/modules/ranking';
import { SortTankingStrategy } from 'src/modules/ranking';
import { OsrmClient } from 'src/modules/route-discovery/services/osrm-client.service';
import { OsrmTableResolver } from 'src/modules/route-discovery/router/osrm.router';
import { DispatchRepository } from 'src/repositories/dispatch.repository';
import { DispatchCandidateRepository } from 'src/repositories/dispatch-candidate.repository';

/**
 * Handle to the ETA module runtime, returned by `bootstrap()`.
 * Call `destroy()` on graceful shutdown to tear down connections.
 */
export interface EtaModuleHandle {
  destroy: () => Promise<void>;
}

/**
 * Bootstrap the ETA module:
 * 1. Creates a RabbitMQ event bus bound to the dispatch exchange
 * 2. Creates the OSRM table resolver and supporting services
 * 3. Wires the TypeORM repositories and Redis batch-state store
 * 4. Provisions the dispatch command queue (asserts exchanges/queues, binds routing keys, starts consuming)
 *
 * @param config - RabbitMQ connection configuration
 * @param dataSource - Initialized TypeORM DataSource
 * @returns A handle with a `destroy()` method for graceful shutdown
 */
export async function bootstrap(
  config: RabbitMQBusConfig,
  dataSource: DataSource,
): Promise<EtaModuleHandle> {
  logger.info('Bootstrapping ETA module...');

  /* --- Event bus --- */
  const eventBus = new RabbitMQBus(
    config,
    DISPATCH_EXCHANGE.name,
    DISPATCH_EXCHANGE.type,
  );

  /* --- Route resolution (OSRM Table for batch evaluation) --- */
  const osrmClient = new OsrmClient();
  const routeMatrixResolver = new OsrmTableResolver(osrmClient);

  /* --- Legacy per-agent router (kept for future geometry/live-ETA use) --- */
  const router = new OsrmRouter();

  /* --- Candidate discovery --- */
  const maxCandidatePool = 50;
  const candidateDiscovery = new ProgressiveCandidateDiscovery(
    cacheService as CacheService,
    maxCandidatePool,
  );

  /* --- Ranking --- */
  const deliveryAgentScoring = new DeliveryAgentScoring();
  const sortStrategy = new SortTankingStrategy();
  const rankingService = new AgentRankingService(sortStrategy, deliveryAgentScoring);

  /* --- ETA aggregator (live speed/weather out-of-scope for V1) --- */
  const etaAggregator = new EtaAggregatorService();

  /* --- ETA service --- */
  const etaService = new EtaService(
    routeMatrixResolver,
    {
      maxTotalDistanceMeters: 15_000,
      maxTotalEtaSeconds: 1800,
    },
    etaAggregator,
    candidateDiscovery,
    rankingService,
  );

  /* --- Repositories --- */
  const dispatchRepo = new DispatchRepository(dataSource);
  const candidateRepo = new DispatchCandidateRepository(dataSource);

  /* --- Redis batch-state store --- */
  const batchStateStore = new DispatchBatchStateStore(cacheService);

  /* --- Command queue --- */
  const commandQueue = new DispatchCommandQueue(
    eventBus,
    router,
    cacheService,
    etaService,
    dispatchRepo,
    candidateRepo,
    batchStateStore,
  );

  await commandQueue.provision();

  logger.info('ETA module bootstrapped successfully', {
    exchange: DISPATCH_EXCHANGE.name,
  });

  return {
    destroy: async () => {
      logger.info('Destroying ETA module...');
      try {
        await eventBus.disconnect();
      } catch (error) {
        logger.error('Error destroying ETA module', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      logger.info('ETA module destroyed.');
    },
  };
}

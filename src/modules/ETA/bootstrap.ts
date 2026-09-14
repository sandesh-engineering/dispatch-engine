import { RabbitMQBus, RabbitMQBusConfig } from './events/rabbitmq.bus';
import { DispatchCommandQueue } from './events/command-queue';
import { DISPATCH_EXCHANGE } from './types/events';
import { logger } from '@platform/logger';
import { cacheService } from 'src/utils/cache-bootstrap';
import { EtaService } from './services/eta-base.service';
import { EtaAggregatorService } from './services/eta-aggregator.service';
import { DriverMetricsProvider } from './services/driver.service';
import { ProgressiveCandidateDiscovery } from 'src/modules/candidate-discovery';
import { AgentRankingService } from 'src/modules/ranking';
import { DeliveryAgentScoring } from 'src/modules/ranking';
import { SortTankingStrategy } from 'src/modules/ranking';
import { OsrmClient } from 'src/modules/route-discovery/services/osrm-client.service';
import { OsrmTableResolver } from 'src/modules/route-discovery/router/osrm.router';
import { CacheService } from '@platform/cache';
import { datasource } from 'src/database/data-source';
import { DispatchRepository } from 'src/repositories/dispatch.repository';
import { DispatchCandidatesRepository } from 'src/repositories/dispatch-candidates.repository';
import { DispatchConfigRepository } from 'src/repositories/dispatch-config.repository';
import { DispatchConfigService } from 'src/services/dispatch-config.service';
import { DriverMetadataResolver } from './services/driver-metadata.resolver';

/**
 * Handle to the ETA module runtime, returned by `bootstrap()`.
 * Call `destroy()` on graceful shutdown to tear down connections.
 */
export interface EtaModuleHandle {
  destroy: () => Promise<void>;
}

/**
 * Bootstrap the ETA module.
 */
export async function bootstrap(
  config: RabbitMQBusConfig,
): Promise<EtaModuleHandle> {
  logger.info('Bootstrapping ETA module...');

  /* Initialize TypeORM DataSource */
  if (!datasource.isInitialized) {
    await datasource.initialize();
    logger.info('Database DataSource initialized');
  }

  /* Repositories & Config Service */
  const dispatchRepo = new DispatchRepository(datasource);
  const candidatesRepo = new DispatchCandidatesRepository(datasource);
  const configRepo = new DispatchConfigRepository(datasource);
  const configService = new DispatchConfigService(configRepo);
  const driverMetadataResolver = new DriverMetadataResolver(cacheService as CacheService);

  /* Fetch dynamic configuration from DB/fallback */
  const runtimeConfig = await configService.getConfig();

  /* 1. Event bus */
  const eventBus = new RabbitMQBus(
    config,
    DISPATCH_EXCHANGE.name,
    DISPATCH_EXCHANGE.type,
  );

  /* 2. Route matrix resolver */
  const osrmClient = new OsrmClient();
  const routeMatrixResolver = new OsrmTableResolver(osrmClient);

  /* 3. Candidate discovery (progressive geo-search over Redis) using dynamic pool size */
  const candidateDiscovery = new ProgressiveCandidateDiscovery(
    cacheService as CacheService,
    runtimeConfig.candidatePoolSize,
  );

  /* 4. Ranking service */
  const sortStrategy = new SortTankingStrategy();
  const scoringService = new DeliveryAgentScoring();
  const rankingService = new AgentRankingService(sortStrategy, scoringService);

  /* 5. ETA aggregator */
  const driverMetrics = new DriverMetricsProvider();
  const etaAggregator = new EtaAggregatorService(driverMetrics);

  /* 6. ETA service with dynamic DB config & Redis driver metadata resolver */
  const etaConfig = {
    maxTotalDistanceMeters: runtimeConfig.maxTotalDistanceMeters,
    maxTotalEtaSeconds: runtimeConfig.maxTotalEtaSeconds,
  };

  const etaService = new EtaService(
    routeMatrixResolver,
    etaConfig,
    etaAggregator,
    candidateDiscovery,
    rankingService,
    datasource,
    dispatchRepo,
    candidatesRepo,
    configService,
    driverMetadataResolver,
  );

  /* 7. Command queue */
  const commandQueue = new DispatchCommandQueue(
    eventBus,
    etaService,
    cacheService,
    dispatchRepo,
    candidatesRepo,
    configService,
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
        if (datasource.isInitialized) {
          await datasource.destroy();
          logger.info('Database connection closed.');
        }
      } catch (error) {
        logger.error('Error destroying ETA module', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      logger.info('ETA module destroyed.');
    },
  };
}

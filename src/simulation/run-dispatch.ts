import 'reflect-metadata';
import { datasource } from '../database/data-source';
import { DispatchRepository } from '../repositories/dispatch.repository';
import { DispatchCandidatesRepository } from '../repositories/dispatch-candidates.repository';
import { DispatchConfigRepository } from '../repositories/dispatch-config.repository';
import { DispatchConfigService } from '../services/dispatch-config.service';
import { EtaService } from '../modules/eta/services/eta-base.service';
import { DispatchCommandQueue } from '../modules/eta/events/command-queue';
import { ProgressiveCandidateDiscovery } from '../modules/candidate-discovery';
import {
  AgentRankingService,
  DeliveryAgentScoring,
  SortTankingStrategy,
} from '../modules/ranking';
import { OsrmClient } from '../modules/route-discovery/services/osrm-client.service';
import { OsrmTableResolver } from '../modules/route-discovery/router/osrm.router';
import { EtaAggregatorService } from '../modules/eta/services/eta-aggregator.service';
import { DriverMetricsProvider } from '../modules/eta/services/driver.service';
import { DriverMetadataResolver } from '../modules/eta/services/driver-metadata.resolver';
import { SimulatedEventBus } from './simulated-event-bus';
import { cacheService } from '../utils/cache-bootstrap';
import { CacheService } from '@platform/cache';
import { logger } from '@platform/logger';
import { DISPATCH_COMMANDS, DispatchCreateCommand } from '../modules/eta/types/events';

async function runSimulation() {
  logger.info('=== Starting Dispatch Engine Simulation ===');

  /* 1. Database connection */
  if (!datasource.isInitialized) {
    await datasource.initialize();
    logger.info('Database initialized');
  }

  /* 2. Repositories */
  const dispatchRepo = new DispatchRepository(datasource);
  const candidatesRepo = new DispatchCandidatesRepository(datasource);
  const configRepo = new DispatchConfigRepository(datasource);
  const configService = new DispatchConfigService(configRepo);

  /* 3. Simulated Event Bus */
  const eventBus = new SimulatedEventBus();

  /* 4. ETA Services setup */
  const osrmClient = new OsrmClient();
  const routeMatrixResolver = new OsrmTableResolver(osrmClient);

  const candidateDiscovery = new ProgressiveCandidateDiscovery(
    cacheService as CacheService,
    15,
  );

  const sortStrategy = new SortTankingStrategy();
  const scoringService = new DeliveryAgentScoring();
  const rankingService = new AgentRankingService(sortStrategy, scoringService);

  const driverMetrics = new DriverMetricsProvider();
  const etaAggregator = new EtaAggregatorService(driverMetrics);
  const driverMetadataResolver = new DriverMetadataResolver(cacheService as CacheService);

  const etaService = new EtaService(
    routeMatrixResolver,
    { maxTotalDistanceMeters: 15000, maxTotalEtaSeconds: 3600 },
    etaAggregator,
    candidateDiscovery,
    rankingService,
    datasource,
    dispatchRepo,
    candidatesRepo,
    configService,
    driverMetadataResolver,
  );

  const commandQueue = new DispatchCommandQueue(
    eventBus,
    etaService,
    cacheService,
    dispatchRepo,
    candidatesRepo,
    configService,
  );

  await commandQueue.provision();

  /* Kathmandu test coordinates */
  const restaurantCoords = { latitude: 27.7172, longitude: 85.324 };
  const customerCoords = { latitude: 27.7215, longitude: 85.3311 };
  const testOrderId = `sim-order-${Date.now()}`;

  /* Seed driver into Redis geo if empty */
  try {
    await (cacheService as any).geoAdd('location:delivery-agents', [
      {
        longitude: 85.325,
        latitude: 27.718,
        member: 'driver-sim-1',
      },
    ]);
    await cacheService.hset('delivery-agent:driver-sim-1', {
      availability: 'AVAILABLE',
      connected: 'true',
    });
    logger.info('Seeded mock driver into Redis: driver-sim-1');
  } catch (err) {
    logger.warn(`Redis seed skipped/failed: ${(err as Error).message}`);
  }

  const createCommand: DispatchCreateCommand = {
    order_id: testOrderId,
    restaurant_id: 'restro-sim-1',
    restaurant_coords: restaurantCoords,
    customer_coords: customerCoords,
  };

  logger.info('Firing DispatchCreateCommand...', { testOrderId });

  await eventBus.publish(DISPATCH_COMMANDS.REQUEST_CREATION, createCommand);

  /* Verify DB records */
  const dispatchRecord = await dispatchRepo.findByOrderId(testOrderId);
  logger.info('Simulation Completed. Created Dispatch Record:', {
    id: dispatchRecord?.id,
    orderId: dispatchRecord?.orderId,
    status: dispatchRecord?.status,
    restaurantToCustomerEtaSeconds: dispatchRecord?.restaurantToCustomerEtaSeconds,
  });

  if (dispatchRecord) {
    const candidateRecords = await candidatesRepo.findByDispatchId(dispatchRecord.id);
    logger.info(`Persisted Candidates Count: ${candidateRecords.length}`, {
      candidates: candidateRecords.map((c) => ({
        driverId: c.driverId,
        offerStatus: c.offerStatus,
        preEtaSeconds: c.preEtaSeconds,
        osrmDistanceMeters: c.osrmDistanceMeters,
      })),
    });
  }

  if (datasource.isInitialized) {
    await datasource.destroy();
  }

  logger.info('=== Simulation Finished Successfully ===');
}

runSimulation().catch((err) => {
  logger.error('Simulation Failed', { error: err.message, stack: err.stack });
  process.exit(1);
});

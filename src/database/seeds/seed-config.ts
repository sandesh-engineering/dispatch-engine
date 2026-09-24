import 'reflect-metadata';
import { datasource } from '../data-source';
import { DispatchConfigEntity } from '../../entities/dispatch-config.entity';
import { logger } from '@platform/logger';

async function seedConfig() {
  logger.info('Starting Dispatch Config database seeding...');

  if (!datasource.isInitialized) {
    await datasource.initialize();
  }

  const repo = datasource.getRepository(DispatchConfigEntity);

  let defaultConfig = await repo.findOne({ where: { isDefault: true } });

  const defaultValues = {
    isDefault: true,
    maxTotalDistanceMeters: 15000,
    maxTotalEtaSeconds: 3600,
    rankingWeights: {
      rating: 0.35,
      cancellationRatio: 0.15,
      quota: 0.25,
      distance: 0.25,
    },
    maxDistanceKm: 10.0,
    candidatePoolSize: 15,
    batchSize: 5,
    searchRadiiKm: [2, 5, 7],
  };

  if (!defaultConfig) {
    defaultConfig = repo.create(defaultValues);
    await repo.save(defaultConfig);
    logger.info('Created new default dispatch_config record in DB:', { id: defaultConfig.id });
  } else {
    Object.assign(defaultConfig, defaultValues);
    await repo.save(defaultConfig);
    logger.info('Updated existing default dispatch_config record in DB:', { id: defaultConfig.id });
  }

  if (datasource.isInitialized) {
    await datasource.destroy();
  }

  logger.info('Dispatch Config seeding completed successfully.');
}

seedConfig().catch((err) => {
  logger.error('Failed to seed dispatch_config:', { error: err.message, stack: err.stack });
  process.exit(1);
});

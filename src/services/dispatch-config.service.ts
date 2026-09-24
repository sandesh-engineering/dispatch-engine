import { logger } from '@platform/logger';
import { DispatchConfigRepository } from '../repositories/dispatch-config.repository';
import { RankingWeights } from '../entities/dispatch-config.entity';

export interface ResolvedDispatchConfig {
  maxTotalDistanceMeters: number;
  maxTotalEtaSeconds: number;
  rankingWeights: RankingWeights;
  maxDistanceKm: number;
  candidatePoolSize: number;
  batchSize: number;
  searchRadiiKm: number[];
}

export const DEFAULT_DISPATCH_CONFIG: ResolvedDispatchConfig = {
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

export class DispatchConfigService {
  constructor(private readonly configRepo: DispatchConfigRepository) {}

  async getConfig(): Promise<ResolvedDispatchConfig> {
    try {
      const dbConfig = await this.configRepo.findDefault();
      if (dbConfig) {
        return {
          maxTotalDistanceMeters: dbConfig.maxTotalDistanceMeters,
          maxTotalEtaSeconds: dbConfig.maxTotalEtaSeconds,
          rankingWeights: dbConfig.rankingWeights,
          maxDistanceKm: dbConfig.maxDistanceKm,
          candidatePoolSize: dbConfig.candidatePoolSize,
          batchSize: dbConfig.batchSize,
          searchRadiiKm: dbConfig.searchRadiiKm,
        };
      }
    } catch (err) {
      logger.warn(
        `Failed to fetch dispatch config from DB, using defaults: ${(err as Error).message}`
      );
    }

    logger.warn(
      'Default dispatch_config not found in DB. Falling back to default settings.'
    );
    return DEFAULT_DISPATCH_CONFIG;
  }
}

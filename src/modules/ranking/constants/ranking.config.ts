/**
 * Static ranking configuration.
 * Weights and limits used for scoring and batch-selecting delivery agents.
 * These values are fixed until a config-service data layer is in place.
 */
import { RankingConfig } from '../types/ranking.types';

export const STATIC_RANKING_CONFIG: RankingConfig = {
  weights: {
    rating: 4.2,
    cancellationRatio: 2,
    quota: 20,
    distance: 5,
  },
  maxDistanceKm: 10,
  batchSize: 5,
};

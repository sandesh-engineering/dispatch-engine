import { RankingConfig } from '../types/ranking.types';

/**
 * Validates the configuration required to perform agent ranking.
 *
 * @remarks
 * - Ensures batch and distance constraints are positive.
 * - Ensures ranking weights are non-negative.
 * - Ensures ranking weights form a valid normalized distribution.
 *
 * @param {RankingConfig} config - Ranking configuration to validate.
 * @returns {void} Does not return a value when the configuration is valid.
 * @throws {Error} Throws an `Error` when the ranking configuration is invalid.
 *
 * @example
 * ```ts
 * this.validateConfig(config);
 * ```
 */
export const validateConfig = (config: RankingConfig): void => {
  if (config.batchSize <= 0) {
    throw new Error('Ranking batch size must be greater than 0');
  }

  if (config.maxDistanceKm <= 0) {
    throw new Error('Maximum ranking distance must be greater than 0');
  }

  const weights = Object.values(config.weights);

  if (weights.some((weight) => weight < 0)) {
    throw new Error('Ranking weights cannot be negative');
  }

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

  if (Math.abs(weightSum - 1) > Number.EPSILON) {
    throw new Error('Ranking weights must sum to 1');
  }
};

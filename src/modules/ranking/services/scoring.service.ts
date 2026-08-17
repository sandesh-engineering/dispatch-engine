import { RankableAgent, RankingConfig } from '../types/ranking.types';

/**
 * Calculates ranking scores for eligible delivery agents.
 *
 * @remarks
 * - Converts agent attributes into normalized scores between `0` and `1`.
 * - Applies the configured weights to each normalized score.
 * - Does not perform candidate discovery, dispatching, or batch delivery.
 */
export class DeliveryAgentScoring {
  /**
   * Calculates a weighted ranking score for a delivery agent.
   *
   * @remarks
   * - Each ranking signal is normalized to the range `0..1`.
   * - Higher normalized values represent a more desirable candidate.
   * - The normalized signals are multiplied by their configured weights.
   *
   * @param {RankableAgent} agent - Delivery agent whose ranking score is calculated.
   * @param {RankingConfig} config - Ranking configuration containing signal weights and normalization constraints.
   * @returns {number} Weighted ranking score for the agent.
   *
   * @example
   * ```ts
   * const score = ranking.calculateScore(agent, config);
   * ```
   */
  public calculateScore(agent: RankableAgent, config: RankingConfig): number {
    /* Normalize the rating scores for DA */
    const ratingScore = this.normalizeRating(agent.rating);

    /* Normalize the cancellation scores for DA */
    const cancellationScore = this.normalizeCancellation(
      agent.cancellationRatio,
    );

    /* Normalize the quota scores for DA (we would need to limit orders for balancing) */
    const quotaScore = this.normalizeQuota(agent.quota.used, agent.quota.limit);

    /* Normalize the distance scores for DA */
    const distanceScore = this.normalizeDistance(
      agent.distanceKm,
      config.maxDistanceKm,
    );

    return (
      ratingScore * config.weights.rating +
      cancellationScore * config.weights.cancellationRatio +
      quotaScore * config.weights.quota +
      distanceScore * config.weights.distance
    );
  }

  /**
   * Normalizes an agent's rating into a `0..1` score.
   *
   * @remarks
   * - The current rating scale is `0..5`.
   * - Higher ratings produce higher normalized scores.
   * - The result is clamped to prevent invalid values outside `0..1`.
   *
   * @param {number} rating - Agent rating on a `0..5` scale.
   * @returns {number} Normalized rating score between `0` and `1`.
   *`
   */
  private normalizeRating(rating: number): number {
    return this.clamp(rating / 5);
  }

  /**
   * Normalizes an agent's cancellation ratio into a desirability score.
   *
   * @remarks
   * - A lower cancellation ratio is considered better.
   * - A ratio of `0` produces a score of `1`.
   * - A ratio of `1` produces a score of `0`.
   *
   * @param {number} ratio - Agent cancellation ratio between `0` and `1`.
   * @returns {number} Normalized cancellation score between `0` and `1`.
   *`
   */
  private normalizeCancellation(ratio: number): number {
    return this.clamp(1 - ratio);
  }

  /**
   * Normalizes an agent's quota utilization into a desirability score.
   *
   * @remarks
   * - Lower quota utilization produces a higher score.
   * - An agent that has used none of its quota receives a score of `1`.
   * - An invalid or non-positive quota limit produces a score of `0`.
   *
   * @param {number} used - Number of quota units already consumed.
   * @param {number} limit - Maximum quota available to the agent.
   * @returns {number} Normalized quota score between `0` and `1`.
   *``
   */
  private normalizeQuota(used: number, limit: number): number {
    if (limit <= 0) {
      return 0;
    }

    return this.clamp(1 - used / limit);
  }

  /**
   * Normalizes an agent's distance into a desirability score.
   *
   * @remarks
   * - A shorter distance produces a higher score.
   * - `maxDistanceKm` represents the maximum distance considered by the ranking configuration.
   * - Candidates at or beyond the maximum distance receive a score of `0`.
   *
   * @param {number} distanceKm - Distance between the agent and the relevant delivery location in kilometers.
   * @param {number} maxDistanceKm - Maximum distance considered by the ranking configuration.
   * @returns {number} Normalized distance score between `0` and `1`.
   */
  private normalizeDistance(distanceKm: number, maxDistanceKm: number): number {
    if (maxDistanceKm <= 0) {
      return 0;
    }

    return this.clamp(1 - distanceKm / maxDistanceKm);
  }

  /**
   * Restricts a numeric value to the inclusive `0..1` range.
   *
   * @remarks
   * - Values below `0` become `0`.
   * - Values above `1` become `1`.
   * - Used to protect normalized ranking signals from invalid input.
   *
   * @param {number} value - Numeric value to clamp.
   * @returns {number} Value constrained to the range `0..1`.`
   */
  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}

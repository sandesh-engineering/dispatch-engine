import { RankableAgent } from '../types/ranking.types';

/**
 * Represents the result of a completed agent-ranking operation.
 *
 * @remarks
 * - Maintains its own position within the ranked candidates.
 * - Returns candidates in batches according to the configured batch size.
 * - Does not perform dispatching or communicate with downstream services.
 *
 * @example
 * ```ts
 * const result = rankingService.rank(candidates, config);
 *
 * const firstBatch = result.nextBatch();
 * const secondBatch = result.nextBatch();
 * ```
 */
export class RankingResult {
  private currentIndex = 0;

  constructor(
    private readonly rankedAgents: RankableAgent[],
    private readonly batchSize: number,
  ) {}

  /**
   * Returns the next batch of ranked delivery agents.
   *
   * @remarks
   * - Candidates are returned in their previously calculated ranking order.
   * - Advances the internal position after returning a batch.
   * - Returns an empty array when all candidates have been consumed.
   *
   * @returns {RankableAgent[]} Next batch of ranked delivery agents.
   *
   * @example
   * ```ts
   * const batch = result.nextBatch();
   *
   * if (batch.length === 0) {
   *   // No candidates remain.
   * }
   * ```
   */
  nextBatch(): RankableAgent[] {
    if (this.currentIndex >= this.rankedAgents.length) {
      return [];
    }

    const batch = this.rankedAgents.slice(
      this.currentIndex,
      this.currentIndex + this.batchSize,
    );

    this.currentIndex += batch.length;

    return batch;
  }
}

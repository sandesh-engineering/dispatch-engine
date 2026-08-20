import { validateConfig } from '../helpers/validate-config.helper';
import {
  IAgentRankingService,
  RankingStrategy,
} from '../interfaces/ranking.interface';
import {
  RankableAgent,
  RankingConfig,
  ScoredAgent,
} from '../types/ranking.types';
import { RankingResult } from './ranking-result.service';
import { DeliveryAgentScoring } from './scoring.service';

export class AgentRankingService implements IAgentRankingService {
  constructor(
    private readonly strategy: RankingStrategy,
    private readonly deliveryAgentScoring: DeliveryAgentScoring,
  ) {}

  /**
   * Ranks eligible delivery agents and creates a batch-based ranking result.
   *
   * @remarks
   * - Calculates a weighted score for every candidate.
   * - Delegates ordering to the configured ranking strategy.
   * - The ranking strategy can be replaced without changing scoring or batch selection.
   *
   * @param {RankableAgent[]} candidates - Eligible delivery agents to rank.
   * @param {RankingConfig} config - Ranking weights and selection configuration.
   * @returns {RankingResult} Stateful result used to retrieve ranked batches.
   *
   * @example
   * ```ts
   * const result = rankingService.rank(candidates, config);
   * const batch = result.nextBatch();
   * ```
   */
  rank(candidates: RankableAgent[], config: RankingConfig): RankingResult {
    /* Validating the passed config */
    validateConfig(config);

    /* Calculate the weighted score for agent */
    const scoredCandidates: ScoredAgent[] = candidates.map((agent) => ({
      agent,
      score: this.deliveryAgentScoring.calculateScore(agent, config),
    }));

    /* Rank the candidates and sort them */
    const rankedCandidates = this.strategy.rank(scoredCandidates);

    /* Getting the ranked agents */
    const rankedAgents = rankedCandidates.map(({ agent }) => agent);

    /* Return the selected batch of ranked agents */
    return new RankingResult(rankedAgents, config.batchSize);
  }
}

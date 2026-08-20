import {
  RankableAgent,
  RankingConfig,
  ScoredAgent,
} from '../types/ranking.types';

interface RankingResult {
  nextBatch(): RankableAgent[];
}

export interface AgentRanking {
  rank(candidates: RankableAgent[], config: RankingConfig): RankingResult;
}

/**
 * Ranking strategy since we need to swap between normal sorting as well as heap for getting the suitable candidate
 */
export interface RankingStrategy {
  rank(candidates: ScoredAgent[]): ScoredAgent[];
}

/**
 * For actual ranking service that orchestrates the overall logic
 */
export interface IAgentRankingService {
  rank(candidates: RankableAgent[], config: RankingConfig): RankingResult;
}

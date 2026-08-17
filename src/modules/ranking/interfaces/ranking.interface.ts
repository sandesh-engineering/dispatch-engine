import { RankableAgent, RankingConfig } from '../types/ranking.types';

interface RankingResult {
  nextBatch(): RankableAgent[];
}

export interface AgentRanking {
  rank(candidates: RankableAgent[], config: RankingConfig): RankingResult;
}

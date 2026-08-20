import { RankingStrategy } from '../interfaces/ranking.interface';
import { ScoredAgent } from '../types/ranking.types';

export class SortTankingStrategy implements RankingStrategy {
  rank(candidates: ScoredAgent[]): ScoredAgent[] {
    return [...candidates].sort((a, b) => b.score - a.score);
  }
}

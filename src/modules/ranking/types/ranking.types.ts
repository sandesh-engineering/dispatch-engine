/**
 * Properties that the agent will have inorder to be ranked
 */
export type RankableAgent = {
  id: string;
  rating: number;
  cancellationRatio: number;
  quota: {
    used: number;
    limit: number;
  };
  distanceKm: number;
};

/**
 * Properties that the ranking config will have
 */
export type RankingConfig = {
  weights: {
    rating: number;
    cancellationRatio: number;
    quota: number;
    distance: number;
  };

  maxDistanceKm: number;
  batchSize: number;
};

export type ScoredAgent = {
  agent: RankableAgent;
  score: number;
};

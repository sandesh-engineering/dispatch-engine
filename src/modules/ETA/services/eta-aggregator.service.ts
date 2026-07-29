export interface ETAAdjustment {
  source: 'TRAFFIC' | 'WEATHER' | 'RESTAURANT' | 'DRIVER' | 'HISTORICAL';

  delaySeconds: number;

  confidence: number;

  metadata?: Record<string, unknown>;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface RankingWeights {
  rating: number;
  cancellationRatio: number;
  quota: number;
  distance: number;
}

@Entity({ name: 'dispatch_config' })
export class DispatchConfigEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'boolean', default: false, name: 'is_default' })
  isDefault!: boolean;

  @Column({ type: 'int', default: 15000, name: 'max_total_distance_meters' })
  maxTotalDistanceMeters!: number;

  @Column({ type: 'int', default: 3600, name: 'max_total_eta_seconds' })
  maxTotalEtaSeconds!: number;

  @Column({ type: 'jsonb', name: 'ranking_weights' })
  rankingWeights!: RankingWeights;

  @Column({ type: 'float', default: 10.0, name: 'max_distance_km' })
  maxDistanceKm!: number;

  @Column({ type: 'int', default: 15, name: 'candidate_pool_size' })
  candidatePoolSize!: number;

  @Column({ type: 'int', default: 5, name: 'batch_size' })
  batchSize!: number;

  @Column({ type: 'jsonb', name: 'search_radii_km' })
  searchRadiiKm!: number[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

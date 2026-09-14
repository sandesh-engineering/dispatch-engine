import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { DispatchEntity } from './dispatch.entity';

export enum CandidateOfferStatus {
  PENDING = 'PENDING',
  OFFERED = 'OFFERED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  TIMED_OUT = 'TIMED_OUT',
}

@Entity({ name: 'dispatch_candidates' })
@Unique(['dispatchId', 'driverId', 'batchNumber'])
export class DispatchCandidateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'dispatch_id' })
  @Index('idx_dispatch_candidates_dispatch_id')
  dispatchId!: string;

  @ManyToOne(() => DispatchEntity, (dispatch) => dispatch.candidates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dispatch_id' })
  dispatch!: DispatchEntity;

  @Column({ type: 'varchar', name: 'driver_id' })
  driverId!: string;

  @Column({ type: 'int', name: 'batch_number' })
  batchNumber!: number;

  @Column({ type: 'float', name: 'redis_distance_meters' })
  redisDistanceMeters!: number;

  @Column({ type: 'float', nullable: true, name: 'osrm_distance_meters' })
  osrmDistanceMeters!: number | null;

  @Column({ type: 'float', nullable: true, name: 'osrm_duration_seconds' })
  osrmDurationSeconds!: number | null;

  @Column({ type: 'float', nullable: true, name: 'pre_eta_seconds' })
  preEtaSeconds!: number | null;

  @Column({ type: 'float', nullable: true, name: 'ranking_score' })
  rankingScore!: number | null;

  @Column({
    type: 'enum',
    enum: CandidateOfferStatus,
    default: CandidateOfferStatus.PENDING,
    name: 'offer_status',
  })
  offerStatus!: CandidateOfferStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'offered_at' })
  offeredAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'responded_at' })
  respondedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

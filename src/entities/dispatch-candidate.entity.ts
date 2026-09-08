import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { OfferStatus } from '../enums/offer-status.enum';
import { DispatchEntity } from './dispatch.entity';

@Entity('dispatch_candidates')
@Unique(['dispatch_id', 'driver_id', 'batch_number'])
@Index(['dispatch_id'])
export class DispatchCandidateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  dispatch_id!: string;

  @ManyToOne(() => DispatchEntity, (dispatch) => dispatch.candidates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'dispatch_id' })
  dispatch!: DispatchEntity;

  @Column({ type: 'varchar' })
  driver_id!: string;

  @Column({ type: 'int' })
  batch_number!: number;

  @Column({ type: 'double precision' })
  redis_distance_meters!: number;

  @Column({ type: 'double precision', nullable: true })
  osrm_distance_meters!: number | null;

  @Column({ type: 'double precision', nullable: true })
  osrm_duration_seconds!: number | null;

  @Column({ type: 'double precision', nullable: true })
  pre_eta_seconds!: number | null;

  @Column({ type: 'double precision', nullable: true })
  ranking_score!: number | null;

  @Column({
    type: 'enum',
    enum: OfferStatus,
    default: OfferStatus.PENDING,
  })
  offer_status!: OfferStatus;

  @Column({ type: 'timestamp', nullable: true })
  offered_at!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  responded_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;
}

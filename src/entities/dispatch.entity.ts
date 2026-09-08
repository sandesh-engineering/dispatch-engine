import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DispatchStatus } from '../enums/dispatch-status.enum';
import { DispatchCandidateEntity } from './dispatch-candidate.entity';

@Entity('dispatches')
export class DispatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  order_id!: string;

  @Column({ type: 'varchar' })
  restaurant_id!: string;

  @Column({
    type: 'enum',
    enum: DispatchStatus,
    default: DispatchStatus.REQUESTED,
  })
  status!: DispatchStatus;

  @Column({ type: 'varchar', nullable: true })
  assigned_driver_id!: string | null;

  @Column({ type: 'int', default: 0 })
  current_batch!: number;

  @Column({ type: 'int', default: 0 })
  attempt_count!: number;

  @Column({ type: 'varchar', nullable: true })
  failure_reason!: string | null;

  @Column({ type: 'double precision', nullable: true })
  restaurant_to_customer_distance_meters!: number | null;

  @Column({ type: 'double precision', nullable: true })
  restaurant_to_customer_duration_seconds!: number | null;

  @Column({ type: 'timestamp', nullable: true })
  assigned_at!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completed_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @OneToMany(
    () => DispatchCandidateEntity,
    (candidate) => candidate.dispatch,
  )
  candidates!: DispatchCandidateEntity[];
}

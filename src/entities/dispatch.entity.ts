import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { DispatchCandidateEntity } from './dispatch-candidate.entity';

export enum DispatchStatus {
  REQUESTED = 'REQUESTED',
  SEARCHING = 'SEARCHING',
  OFFERING = 'OFFERING',
  ASSIGNED = 'ASSIGNED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

@Entity({ name: 'dispatches' })
export class DispatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true, name: 'order_id' })
  orderId!: string;

  @Column({ type: 'varchar', name: 'restaurant_id' })
  restaurantId!: string;

  @Column({ type: 'jsonb', name: 'restaurant_coords' })
  restaurantCoords!: { latitude: number; longitude: number };

  @Column({ type: 'jsonb', name: 'customer_coords' })
  customerCoords!: { latitude: number; longitude: number };

  @Column({
    type: 'enum',
    enum: DispatchStatus,
    default: DispatchStatus.REQUESTED,
  })
  status!: DispatchStatus;

  @Column({ type: 'varchar', nullable: true, name: 'assigned_driver_id' })
  assignedDriverId!: string | null;

  @Column({ type: 'int', default: 0, name: 'current_batch' })
  currentBatch!: number;

  @Column({ type: 'int', default: 0, name: 'attempt_count' })
  attemptCount!: number;

  @Column({ type: 'varchar', nullable: true, name: 'failure_reason' })
  failureReason!: string | null;

  @Column({
    type: 'int',
    nullable: true,
    name: 'restaurant_to_customer_eta_seconds',
  })
  restaurantToCustomerEtaSeconds!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'assigned_at' })
  assignedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt!: Date | null;

  @OneToMany(() => DispatchCandidateEntity, (candidate) => candidate.dispatch)
  candidates!: DispatchCandidateEntity[];
}

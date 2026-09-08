import { DataSource, In, Not, Repository } from 'typeorm';
import { DispatchEntity } from '../entities/dispatch.entity';
import { DispatchStatus } from '../enums/dispatch-status.enum';

export class DispatchRepository {
  private readonly repo: Repository<DispatchEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(DispatchEntity);
  }

  /**
   * Atomically insert or retrieve an existing dispatch record for an order.
   */
  async createOrGetByOrderId(data: {
    order_id: string;
    restaurant_id: string;
    status?: DispatchStatus;
  }): Promise<DispatchEntity> {
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(DispatchEntity)
      .values({
        order_id: data.order_id,
        restaurant_id: data.restaurant_id,
        status: data.status ?? DispatchStatus.REQUESTED,
      })
      .orIgnore()
      .execute();

    const dispatch = await this.repo.findOne({
      where: { order_id: data.order_id },
    });

    if (!dispatch) {
      throw new Error(
        `Failed to create or retrieve dispatch for order ${data.order_id}`,
      );
    }

    return dispatch;
  }

  /**
   * Find dispatch by ID.
   */
  async findById(id: string): Promise<DispatchEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Find dispatch by order ID.
   */
  async findByOrderId(order_id: string): Promise<DispatchEntity | null> {
    return this.repo.findOne({ where: { order_id } });
  }

  /**
   * Guarded transition from REQUESTED to SEARCHING.
   * Returns number of affected rows (1 if successful, 0 if already transitioned).
   */
  async transitionToSearching(id: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({ status: DispatchStatus.SEARCHING })
      .where('id = :id AND status = :expectedStatus', {
        id,
        expectedStatus: DispatchStatus.REQUESTED,
      })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Guarded transition to OFFERING with initial batch and optional shared route details.
   */
  async transitionToOffering(
    id: string,
    currentBatch: number,
    restaurantToCustomer?: {
      distanceMeters: number;
      durationSeconds: number;
    } | null,
  ): Promise<number> {
    const qb = this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({
        status: DispatchStatus.OFFERING,
        current_batch: currentBatch,
        attempt_count: 1,
        ...(restaurantToCustomer
          ? {
              restaurant_to_customer_distance_meters:
                restaurantToCustomer.distanceMeters,
              restaurant_to_customer_duration_seconds:
                restaurantToCustomer.durationSeconds,
            }
          : {}),
      })
      .where('id = :id AND status IN (:...expectedStatuses)', {
        id,
        expectedStatuses: [DispatchStatus.REQUESTED, DispatchStatus.SEARCHING],
      });

    const result = await qb.execute();
    return result.affected ?? 0;
  }

  /**
   * Guarded assignment transition: only succeeds if currently OFFERING and unassigned.
   * Returns affected row count.
   */
  async assignDriver(id: string, driverId: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({
        status: DispatchStatus.ASSIGNED,
        assigned_driver_id: driverId,
        assigned_at: () => 'NOW()',
      })
      .where('id = :id AND status = :status AND assigned_driver_id IS NULL', {
        id,
        status: DispatchStatus.OFFERING,
      })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Guarded batch advancement with atomic attempt_count increment.
   * Returns affected row count.
   */
  async advanceBatch(
    id: string,
    nextBatch: number,
    expectedCurrentBatch: number,
  ): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({
        current_batch: nextBatch,
        attempt_count: () => 'attempt_count + 1',
        status: DispatchStatus.OFFERING,
      })
      .where(
        'id = :id AND status = :status AND current_batch = :expectedCurrentBatch',
        {
          id,
          status: DispatchStatus.OFFERING,
          expectedCurrentBatch,
        },
      )
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Guarded failure transition when candidates are exhausted or discovery fails.
   */
  async failDispatch(id: string, failureReason: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({
        status: DispatchStatus.FAILED,
        failure_reason: failureReason,
      })
      .where('id = :id AND status IN (:...statuses)', {
        id,
        statuses: [
          DispatchStatus.REQUESTED,
          DispatchStatus.SEARCHING,
          DispatchStatus.OFFERING,
        ],
      })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Guarded completion transition.
   */
  async completeDispatch(id: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({
        status: DispatchStatus.COMPLETED,
        completed_at: () => 'NOW()',
      })
      .where('id = :id AND status = :status', {
        id,
        status: DispatchStatus.ASSIGNED,
      })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Guarded cancellation transition.
   */
  async cancelDispatch(id: string, reason?: string): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({
        status: DispatchStatus.CANCELLED,
        failure_reason: reason ?? 'CANCELLED',
      })
      .where('id = :id AND status NOT IN (:...terminalStatuses)', {
        id,
        terminalStatuses: [
          DispatchStatus.COMPLETED,
          DispatchStatus.CANCELLED,
          DispatchStatus.FAILED,
        ],
      })
      .execute();

    return result.affected ?? 0;
  }
}

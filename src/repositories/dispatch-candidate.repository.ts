import { DataSource, In, Repository } from 'typeorm';
import { DispatchCandidateEntity } from '../entities/dispatch-candidate.entity';
import { OfferStatus } from '../enums/offer-status.enum';

export class DispatchCandidateRepository {
  private readonly repo: Repository<DispatchCandidateEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(DispatchCandidateEntity);
  }

  /**
   * Insert batch of candidates using unique constraint with orIgnore to handle duplicates.
   */
  async insertBatch(
    candidates: Partial<DispatchCandidateEntity>[],
  ): Promise<void> {
    if (candidates.length === 0) return;

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(DispatchCandidateEntity)
      .values(candidates)
      .orIgnore()
      .execute();
  }

  /**
   * Guarded update for recording a candidate offer response exactly once.
   * Only transitions candidates currently in OFFERED status.
   */
  async respondOnce(params: {
    dispatchId: string;
    driverId: string;
    batchNumber: number;
    status: OfferStatus;
  }): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchCandidateEntity)
      .set({
        offer_status: params.status,
        responded_at: () => 'NOW()',
      })
      .where(
        'dispatch_id = :dispatchId AND driver_id = :driverId AND batch_number = :batchNumber AND offer_status = :expectedStatus',
        {
          dispatchId: params.dispatchId,
          driverId: params.driverId,
          batchNumber: params.batchNumber,
          expectedStatus: OfferStatus.OFFERED,
        },
      )
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Mark all PENDING candidates in a batch as OFFERED.
   */
  async markBatchOffered(
    dispatchId: string,
    batchNumber: number,
  ): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchCandidateEntity)
      .set({
        offer_status: OfferStatus.OFFERED,
        offered_at: () => 'NOW()',
      })
      .where(
        'dispatch_id = :dispatchId AND batch_number = :batchNumber AND offer_status = :status',
        {
          dispatchId,
          batchNumber,
          status: OfferStatus.PENDING,
        },
      )
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Guarded timeout: mark stale OFFERED candidates as TIMED_OUT.
   */
  async markStaleOfferedTimedOut(
    dispatchId: string,
    batchNumber: number,
    staleBefore: Date,
  ): Promise<number> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchCandidateEntity)
      .set({
        offer_status: OfferStatus.TIMED_OUT,
        responded_at: () => 'NOW()',
      })
      .where(
        'dispatch_id = :dispatchId AND batch_number = :batchNumber AND offer_status = :status AND offered_at <= :staleBefore',
        {
          dispatchId,
          batchNumber,
          status: OfferStatus.OFFERED,
          staleBefore,
        },
      )
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Find candidates by dispatch ID and batch number.
   */
  async findByDispatchAndBatch(
    dispatchId: string,
    batchNumber: number,
  ): Promise<DispatchCandidateEntity[]> {
    return this.repo.find({
      where: {
        dispatch_id: dispatchId,
        batch_number: batchNumber,
      },
    });
  }

  /**
   * Find all candidates for a dispatch.
   */
  async findByDispatchId(
    dispatchId: string,
  ): Promise<DispatchCandidateEntity[]> {
    return this.repo.find({
      where: {
        dispatch_id: dispatchId,
      },
      order: {
        batch_number: 'ASC',
        created_at: 'ASC',
      },
    });
  }

  /**
   * Check if all candidates in a batch are in terminal states.
   */
  async isBatchTerminal(
    dispatchId: string,
    batchNumber: number,
  ): Promise<boolean> {
    const candidates = await this.findByDispatchAndBatch(
      dispatchId,
      batchNumber,
    );
    if (candidates.length === 0) return true;

    const terminalStatuses: OfferStatus[] = [
      OfferStatus.ACCEPTED,
      OfferStatus.REJECTED,
      OfferStatus.TIMED_OUT,
      OfferStatus.CANCELLED,
    ];

    return candidates.every((candidate) =>
      terminalStatuses.includes(candidate.offer_status),
    );
  }

  /**
   * Check if any candidate in a batch has accepted.
   */
  async hasBatchAccepted(
    dispatchId: string,
    batchNumber: number,
  ): Promise<boolean> {
    const candidates = await this.findByDispatchAndBatch(
      dispatchId,
      batchNumber,
    );
    return candidates.some((c) => c.offer_status === OfferStatus.ACCEPTED);
  }
}

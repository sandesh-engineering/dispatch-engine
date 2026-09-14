import { DataSource, Repository } from 'typeorm';
import {
  DispatchCandidateEntity,
  CandidateOfferStatus,
} from '../entities/dispatch-candidate.entity';

export class DispatchCandidatesRepository {
  private repo: Repository<DispatchCandidateEntity>;

  constructor(private dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(DispatchCandidateEntity);
  }

  async insertBatch(candidates: Partial<DispatchCandidateEntity>[]): Promise<void> {
    if (candidates.length === 0) return;

    await this.repo
      .createQueryBuilder()
      .insert()
      .into(DispatchCandidateEntity)
      .values(candidates)
      .orIgnore()
      .execute();
  }

  async findByDispatchId(dispatchId: string): Promise<DispatchCandidateEntity[]> {
    return await this.repo.find({
      where: { dispatchId },
      order: { batchNumber: 'ASC', rankingScore: 'DESC' },
    });
  }

  async updateOfferStatus(
    dispatchId: string,
    driverId: string,
    batchNumber: number,
    offerStatus: CandidateOfferStatus,
    extra?: Partial<DispatchCandidateEntity>
  ): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchCandidateEntity)
      .set({
        offerStatus,
        ...extra,
      })
      .where('dispatch_id = :dispatchId', { dispatchId })
      .andWhere('driver_id = :driverId', { driverId })
      .andWhere('batch_number = :batchNumber', { batchNumber })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async updateBatchOfferStatus(
    dispatchId: string,
    driverIds: string[],
    batchNumber: number,
    offerStatus: CandidateOfferStatus,
    extra?: Partial<DispatchCandidateEntity>
  ): Promise<void> {
    if (driverIds.length === 0) return;

    await this.repo
      .createQueryBuilder()
      .update(DispatchCandidateEntity)
      .set({
        offerStatus,
        ...extra,
      })
      .where('dispatch_id = :dispatchId', { dispatchId })
      .andWhere('batch_number = :batchNumber', { batchNumber })
      .andWhere('driver_id IN (:...driverIds)', { driverIds })
      .execute();
  }
}

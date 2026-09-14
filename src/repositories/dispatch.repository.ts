import { DataSource, Repository } from 'typeorm';
import { DispatchEntity, DispatchStatus } from '../entities/dispatch.entity';

export class DispatchRepository {
  private repo: Repository<DispatchEntity>;

  constructor(private dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(DispatchEntity);
  }

  async createDispatch(data: Partial<DispatchEntity>): Promise<DispatchEntity> {
    const dispatch = this.repo.create(data);
    return await this.repo.save(dispatch);
  }

  async findByOrderId(orderId: string): Promise<DispatchEntity | null> {
    return await this.repo.findOne({ where: { orderId } });
  }

  async findById(id: string): Promise<DispatchEntity | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async updateStatus(
    id: string,
    expectedStatus: DispatchStatus | DispatchStatus[],
    nextStatus: DispatchStatus,
    extra?: Partial<DispatchEntity>
  ): Promise<boolean> {
    const expectedArray = Array.isArray(expectedStatus)
      ? expectedStatus
      : [expectedStatus];

    const result = await this.repo
      .createQueryBuilder()
      .update(DispatchEntity)
      .set({
        status: nextStatus,
        ...extra,
      })
      .where('id = :id', { id })
      .andWhere('status IN (:...expectedArray)', { expectedArray })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async save(dispatch: DispatchEntity): Promise<DispatchEntity> {
    return await this.repo.save(dispatch);
  }
}

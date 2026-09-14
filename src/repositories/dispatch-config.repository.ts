import { DataSource, Repository } from 'typeorm';
import { DispatchConfigEntity } from '../entities/dispatch-config.entity';

export class DispatchConfigRepository {
  private repo: Repository<DispatchConfigEntity>;

  constructor(private dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(DispatchConfigEntity);
  }

  async findDefault(): Promise<DispatchConfigEntity | null> {
    return await this.repo.findOne({ where: { isDefault: true } });
  }

  async save(config: DispatchConfigEntity): Promise<DispatchConfigEntity> {
    return await this.repo.save(config);
  }
}

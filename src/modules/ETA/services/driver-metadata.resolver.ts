import { ICacheService } from '@platform/cache';
import { logger } from '@platform/logger';

export interface DriverMetadata {
  rating: number;
  cancellationRatio: number;
  quota: {
    used: number;
    limit: number;
  };
}

export const DEFAULT_DRIVER_METADATA: DriverMetadata = {
  rating: 4.5,
  cancellationRatio: 0.05,
  quota: { used: 0, limit: 10 },
};

export class DriverMetadataResolver {
  constructor(private readonly cacheService: ICacheService) {}

  async resolve(driverId: string): Promise<DriverMetadata> {
    try {
      const data = await this.cacheService.hgetall<Record<string, string>>(
        `delivery-agent:${driverId}`,
      );
      if (data && Object.keys(data).length > 0) {
        return {
          rating: data.rating ? parseFloat(data.rating) : DEFAULT_DRIVER_METADATA.rating,
          cancellationRatio: data.cancellationRatio
            ? parseFloat(data.cancellationRatio)
            : DEFAULT_DRIVER_METADATA.cancellationRatio,
          quota: {
            used: data.quotaUsed ? parseInt(data.quotaUsed, 10) : 0,
            limit: data.quotaLimit ? parseInt(data.quotaLimit, 10) : 10,
          },
        };
      }
    } catch (err) {
      logger.warn(
        `Failed to fetch driver metadata for ${driverId} from Redis: ${(err as Error).message}`,
      );
    }

    return DEFAULT_DRIVER_METADATA;
  }
}

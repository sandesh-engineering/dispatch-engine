import { CacheManager, CacheService, ICacheService } from '@platform/cache';
import { env } from '../config/envs';

export let cacheService: ICacheService;

const bootstrapCache = () => {
  if (cacheService) return;

  /* Bootstrap the client */
  const manager = new CacheManager({
    port: Number(env.REDIS_PORT),
    host: env.REDIS_HOST,
  });

  /* Create the cache service (singleton) instance */
  cacheService = new CacheService(manager.getClient());
};

bootstrapCache();

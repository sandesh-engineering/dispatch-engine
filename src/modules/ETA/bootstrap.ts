import { RabbitMQBus, RabbitMQBusConfig } from './events/rabbitmq.bus';
import { DispatchCommandQueue } from './events/command-queue';
import { OsrmRouter } from './router/osrm.router';
import { DISPATCH_EXCHANGE } from './types/events';
import { logger } from '@platform/logger';
import { cacheService } from 'src/utils/cache-bootstrap';

/**
 * Handle to the ETA module runtime, returned by `bootstrap()`.
 * Call `destroy()` on graceful shutdown to tear down connections.
 */
export interface EtaModuleHandle {
  destroy: () => Promise<void>;
}

/**
 * Bootstrap the ETA module:
 * 1. Creates a RabbitMQ event bus bound to the dispatch exchange
 * 2. Creates the OSRM router (with circuit breaker)
 * 3. Provisions the dispatch command queue (asserts exchanges/queues, binds routing keys, starts consuming)
 *
 * @param config - RabbitMQ connection configuration
 * @returns A handle with a `destroy()` method for graceful shutdown
 */
export async function bootstrap(
  config: RabbitMQBusConfig,
): Promise<EtaModuleHandle> {
  logger.info('Bootstrapping ETA module...');

  const eventBus = new RabbitMQBus(
    config,
    DISPATCH_EXCHANGE.name,
    DISPATCH_EXCHANGE.type,
  );

  const router = new OsrmRouter();
  const commandQueue = new DispatchCommandQueue(eventBus, router, cacheService);

  await commandQueue.provision();

  logger.info('ETA module bootstrapped successfully', {
    exchange: DISPATCH_EXCHANGE.name,
  });

  return {
    destroy: async () => {
      logger.info('Destroying ETA module...');
      try {
        await eventBus.disconnect();
      } catch (error) {
        logger.error('Error destroying ETA module', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      logger.info('ETA module destroyed.');
    },
  };
}

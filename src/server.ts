import { app } from './app';
import { env } from './config/envs';
import { logger } from '@platform/logger';
import { bootstrap, EtaModuleHandle } from './modules/eta';

let etaModule: EtaModuleHandle | null = null;
let isShuttingDown = false;

(async () => {
  try {
    app.listen(env.PORT, () => {
      logger.info(`Server is running in port ${env.PORT}!`);
    });

    /* Bootstrap the ETA module — connects RabbitMQ, provisions the command queue */
    logger.info('Initializing ETA module...');

    etaModule = await bootstrap({
      url: env.RABBITMQ_URL,
      username: env.RABBITMQ_USER,
      password: env.RABBITMQ_PASS,
      heartbeat: Number(env.RABBITMQ_HEARTBEAT),
    });

    logger.info('ETA module initialized successfully');
  } catch (error) {
    logger.error('Failed to bootstrap ETA module', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
})();

/* Graceful shutdown handlers */
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    if (etaModule) {
      await etaModule.destroy();
    }

    logger.info('Graceful shutdown completed.');
    process.exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

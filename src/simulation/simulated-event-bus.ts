import { IEventBus } from '../interfaces/event-bus.interface';
import { logger } from '@platform/logger';

export class SimulatedEventBus implements IEventBus {
  private handlers = new Map<
    string,
    Array<(data: any, headers?: Record<string, unknown>) => Promise<void>>
  >();

  async connect(): Promise<void> {
    logger.info('[SimulatedEventBus] Connected');
  }

  async disconnect(): Promise<void> {
    logger.info('[SimulatedEventBus] Disconnected');
  }

  async publish<T = unknown>(routingKey: string, payload: T): Promise<void> {
    logger.info(`[SimulatedEventBus] Published -> Key: ${routingKey}`, { payload });
    const queueHandlers = this.handlers.get(routingKey) || [];
    for (const handler of queueHandlers) {
      await handler(payload, { trace: {} });
    }
  }

  async subscribe<T = unknown>(
    queue: string,
    routingKeys: string[],
    handler: (data: T, headers?: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    for (const key of routingKeys) {
      if (!this.handlers.has(key)) {
        this.handlers.set(key, []);
      }
      this.handlers.get(key)!.push(handler as any);
    }
    logger.info(
      `[SimulatedEventBus] Subscribed to ${routingKeys.join(', ')} on queue ${queue}`,
    );
  }
}

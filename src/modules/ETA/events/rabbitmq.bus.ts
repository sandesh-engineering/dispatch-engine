import { ConnectionManager, RabbitMQService } from '@platform/queue-rabbitmq';
import { logger } from '@platform/logger';
import { IEventBus } from 'src/interfaces/event-bus.interface';
import { ContextPropagation } from 'src/tracing/propagation/context';

export type RabbitMQBusConfig = {
  url: string;
  username?: string;
  password?: string;
  heartbeat?: number;
};

/**
 * External RabbitMQ event bus that connects via the platform's
 * ConnectionManager + RabbitMQService wrapper.
 *
 * Usage:
 * - Connect on startup
 * - Publish outbound events to the configured exchange
 * - Subscribe to inbound commands by binding routing keys to a queue
 */
export class RabbitMQBus implements IEventBus {
  private manager: ConnectionManager | null = null;
  private rabbitmqService: RabbitMQService | null = null;
  private connected = false;

  constructor(
    private readonly config: RabbitMQBusConfig,
    private readonly exchangeName: string,
    private readonly exchangeType: string,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    this.manager = new ConnectionManager({
      url: this.config.url,
      heartbeat: this.config.heartbeat ?? 60,
      username: this.config.username,
      password: this.config.password,
    });

    this.rabbitmqService = new RabbitMQService(this.manager);
    await this.rabbitmqService.init();
    await this.rabbitmqService.createChannel();

    /* Assert the exchange — idempotent, safe to call on each connect */
    await this.rabbitmqService.assertExchange(
      this.exchangeName,
      this.exchangeType,
      { durable: true },
    );

    this.connected = true;

    logger.info('RabbitMQBus connected', {
      exchange: this.exchangeName,
      type: this.exchangeType,
    });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.manager?.close();
    } catch (error) {
      logger.error('RabbitMQBus disconnect error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.manager = null;
    this.rabbitmqService = null;
    this.connected = false;
  }

  async publish<T = unknown>(routingKey: string, payload: T): Promise<void> {
    this.ensureConnected();

    const traceCarrier = ContextPropagation.createCarrier();

    const published = await this.rabbitmqService!.publish(
      this.exchangeName,
      routingKey,
      payload,
      { persistent: true, headers: { trace: traceCarrier } },
    );

    if (!published) {
      /* Channel write buffer is full — wait for drain event */
      await new Promise<void>((resolve, reject) => {
        const channel = this.rabbitmqService!.getChannel();
        const onDrain = () => {
          channel.removeListener('error', onError);
          resolve();
        };
        const onError = (err: Error) => {
          channel.removeListener('drain', onDrain);
          reject(err);
        };
        channel.once('drain', onDrain);
        channel.once('error', onError);
      });
    }
  }

  async subscribe<T = unknown>(
    queue: string,
    routingKeys: string[],
    handler: (data: T, headers?: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    this.ensureConnected();

    const svc = this.rabbitmqService!;

    /*
     * Assert the consumer queue.
     */
    try {
      await svc.assertQueue(queue, {
        durable: true,
      });
    } catch {
      logger.warn(
        'Queue already exists with different args — re-asserting with durable only',
        { queue },
      );
    }

    /* Bind each routing key to the queue */
    const channel = svc.getChannel();

    for (const routingKey of routingKeys) {
      await channel.bindQueue(queue, this.exchangeName, routingKey);
    }

    /* Set prefetch for backpressure */
    await svc.prefetch(10);

    /* Start consuming */
    await svc.consume<T>(queue, async (data, msg) => {
      try {
        logger.info('Received dispatch command', {
          routingKeys,
          queue,
        });

        await handler(data, msg.properties?.headers);

        svc.ack(msg);
      } catch (error) {
        logger.error('Error processing dispatch command — nacking to DLQ', {
          routingKeys,
          queue,
          error: error instanceof Error ? error.message : String(error),
        });

        svc.nack(msg, false, false);
      }
    });

    logger.info('Subscribed to dispatch commands', {
      queue,
      routingKeys,
      exchange: this.exchangeName,
    });
  }

  /**
   * Returns the underlying RabbitMQ service for advanced operations
   * (e.g. accessing the raw channel for queue binding).
   */
  getService(): RabbitMQService {
    this.ensureConnected();
    return this.rabbitmqService!;
  }

  /**
   * Guards against usage before connect().
   */
  private ensureConnected(): void {
    if (!this.connected || !this.rabbitmqService) {
      throw new Error('RabbitMQBus is not connected. Call connect() first.');
    }
  }
}

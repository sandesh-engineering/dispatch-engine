import { EventEmitter } from 'events';
import { IEventBus } from 'src/interfaces/event-bus.interface';

/**
 * Internal in-process event bus using Node.js EventEmitter.
 *
 * Use cases:
 * - Internal communication between the modules (ETA, TOP Candidate selection etc.)
 */
export class InternalEventBus implements IEventBus {
  private readonly emitter: EventEmitter;
  private connected = false;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(100);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.emitter.removeAllListeners();
    this.connected = false;
  }

  async publish<T = unknown>(routingKey: string, payload: T): Promise<void> {
    if (!this.connected) {
      throw new Error(
        'InternalEventBus is not connected. Call connect() first.',
      );
    }

    this.emitter.emit(routingKey, payload);
  }

  async subscribe<T = unknown>(
    queue: string,
    routingKeys: string[],
    handler: (data: T) => Promise<void>,
  ): Promise<void> {
    if (!this.connected) {
      throw new Error(
        'InternalEventBus is not connected. Call connect() first.',
      );
    }

    for (const routingKey of routingKeys) {
      this.emitter.on(routingKey, async (data: T) => {
        try {
          await handler(data);
        } catch (error) {
          console.error(
            `[InternalEventBus] Handler error for routingKey "${routingKey}":`,
            error,
          );
        }
      });
    }
  }
}

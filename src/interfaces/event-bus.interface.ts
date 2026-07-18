/**
 * Common interface for internal (EventEmitter) and external (RabbitMQ) EDA communication.
 *
 * - `publish`: Emit an event/message with a routing key and payload.
 * - `subscribe`: Listen for one or more routing keys on a shared queue/namespace.
 * - `connect`: Bootstrap the underlying transport (e.g. create channel, assert exchanges).
 * - `disconnect`: Tear down the transport gracefully.
 */
export interface IEventBus {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  publish<T = unknown>(routingKey: string, payload: T): Promise<void>;
  subscribe<T = unknown>(
    queue: string,
    routingKeys: string[],
    handler: (data: T) => Promise<void>,
  ): Promise<void>;
}

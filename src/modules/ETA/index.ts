/**
 * ETA Module — Dispatch Engine
 *
 * Provides:
 * - `bootstrap` / `EtaModuleHandle` — lifecycle management (startup + graceful shutdown)
 * - `IEventBus` — common interface for internal (EventEmitter) and external (RabbitMQ) EDA
 * - `InternalEventBus` — in-process event bus for testing / local dev
 * - `RabbitMQBus` — RabbitMQ-backed event bus for production
 * - `DispatchCommandQueue` — listens for dispatch commands and computes routes/ETA
 * - `OsrmRouter` — OSRM-based route resolution with circuit breaker
 * - Event type definitions and constants
 */

export { bootstrap, EtaModuleHandle } from './bootstrap';

export { IEventBus } from '../../interfaces/event-bus.interface';

export { RabbitMQBus, RabbitMQBusConfig } from './events/rabbitmq.bus';
export { DispatchCommandQueue } from './events/command-queue';

export { OsrmRouter } from './router/osrm.router';
export { IRouteResolutionRouter } from './interfaces/router.interface';

export {
  DISPATCH_COMMANDS,
  DISPATCH_EVENTS,
  DISPATCH_EXCHANGE,
  DispatchCreateCommand,
  DispatchAgentSelectionCommand,
  DispatchAgentAssignmentCommand,
  DispatchCreatedEvent,
  AgentNotifiedEvent,
  AgentAssignedEvent,
  DispatchCommandPayload,
  DispatchEventPayload,
} from './types/events';

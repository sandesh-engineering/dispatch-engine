/**
 * ETA Module — Dispatch Engine
 *
 * Provides:
 * - `bootstrap` / `EtaModuleHandle` — lifecycle management (startup + graceful shutdown)
 * - `IEventBus` — common interface for internal (EventEmitter) and external (RabbitMQ) EDA
 * - `RabbitMQBus` — RabbitMQ-backed event bus for production
 * - `DispatchCommandQueue` — listens for dispatch commands, delegates to EtaService
 * - `EtaService` — orchestrates candidate discovery, ranking, and route matrix resolution
 * - Event type definitions and constants
 */

export { bootstrap, EtaModuleHandle } from './bootstrap';

export { IEventBus } from '../../interfaces/event-bus.interface';

export { RabbitMQBus, RabbitMQBusConfig } from './events/rabbitmq.bus';
export { DispatchCommandQueue } from './events/command-queue';

export { EtaService } from './services/eta-base.service';
export { IRouteResolutionRouter } from '../route-discovery/interfaces/router.interface';

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

export { AgentAvailabilityStatus } from './interfaces/agent.interface';


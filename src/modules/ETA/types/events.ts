/**
 * Dispatch command routing keys — these are the commands the dispatch engine
 * subscribes to from the orchestrator.
 */
export const DISPATCH_COMMANDS = {
  REQUEST_CREATION: 'dispatch.v1.request-creation',
  REQUEST_AGENT_SELECTION: 'dispatch.v1.request-agent-selection',
  CONFIRM_AGENT_ASSIGNMENT: 'dispatch.v1.confirm-agent-assignment',
} as const;

/**
 * Dispatch result event routing keys — these are the events the dispatch engine
 * publishes back to the orchestrator.
 */
export const DISPATCH_EVENTS = {
  CREATED: 'dispatch.v1.created',
  CREATION_REJECTED: 'dispatch.v1.creation-rejected',
  AGENT_NOTIFIED: 'agent.v1.notified',
  AGENT_ASSIGNED: 'agent.v1.assigned',
} as const;

/**
 * Dispatch exchange configuration.
 */
export const DISPATCH_EXCHANGE = {
  name: 'dispatch.exchange',
  type: 'topic',
} as const;

/**
 * Payload for `dispatch.v1.request-creation`.
 * Sent by the orchestrator when a new dispatch should be created.
 */
export interface DispatchCreateCommand {
  order_id: string;
  restaurant_id: string;
  restaurant_coords: { latitude: number; longitude: number };
  customer_coords: { latitude: number; longitude: number };
}

/**
 * Payload for `dispatch.v1.request-agent-selection`.
 * Sent by the orchestrator after the restaurant has accepted the order.
 */
export interface DispatchAgentSelectionCommand {
  dispatch_id: string;
  order_id: string;
  restaurant_coords: { latitude: number; longitude: number };
  customer_coords: { latitude: number; longitude: number };
}

/**
 * Payload for `dispatch.v1.confirm-agent-assignment`.
 * Sent by the orchestrator to confirm which agent was assigned.
 */
export interface DispatchAgentAssignmentCommand {
  dispatch_id: string;
  order_id: string;
  agent_id: string;
}

/**
 * Payload for `dispatch.v1.created` event.
 * Published after routes and ETA have been computed.
 */
export interface DispatchCreatedEvent {
  dispatch_id: string;
  order_id: string;
  agent_to_restaurant: {
    distance_meters: number;
    duration_seconds: number;
    polyline: unknown;
  };
  restaurant_to_customer: {
    distance_meters: number;
    duration_seconds: number;
    polyline: unknown;
  };
  total_eta_seconds: number;
  created_at: string;
}

/**
 * Payload for `agent.v1.notified` event.
 * Published after agents have been notified of a new dispatch.
 */
export interface AgentNotifiedEvent {
  dispatch_id: string;
  order_id: string;
  agent_id: string;
  notified_at: string;
}

/**
 * Payload for `agent.v1.assigned` event.
 * Published after an agent has been confirmed for the dispatch.
 */
export interface AgentAssignedEvent {
  dispatch_id: string;
  order_id: string;
  agent_id: string;
  assigned_at: string;
}

/**
 * Union type of all dispatch command payloads.
 */
export type DispatchCommandPayload =
  | DispatchCreateCommand
  | DispatchAgentSelectionCommand
  | DispatchAgentAssignmentCommand;

/**
 * Union type of all dispatch event payloads.
 */
export type DispatchEventPayload =
  | DispatchCreatedEvent
  | AgentNotifiedEvent
  | AgentAssignedEvent;

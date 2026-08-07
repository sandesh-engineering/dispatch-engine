/**
 * Represents the lifecycle of a single delivery order.
 */
export enum OrderStatus {
  ASSIGNED = 'ASSIGNED', // Order offered/sent to the agent
  ACCEPTED = 'ACCEPTED', // Agent accepted the order
  REJECTED = 'REJECTED', // Agent turned down the order
  AT_STORE = 'AT_STORE', // Agent arrived at the pickup location
  PICKED_UP = 'PICKED_UP', // Agent picked up the items
  ON_THE_WAY = 'ON_THE_WAY', // Agent is traveling to the customer
  ARRIVED = 'ARRIVED', // Agent reached the customer's location
  DELIVERED = 'DELIVERED', // Order successfully completed (Terminal state)
  CANCELLED = 'CANCELLED', // Order cancelled by user/system (Terminal state)
  FAILED_ATTEMPT = 'FAILED', // Delivery failed, e.g., customer unreachable (Terminal state)
}

/**
 * Business logic status used to filter and exclude agents from the matching pool.
 * Note: Valid only for single-order assignments.
 */
export enum AgentAvailabilityStatus {
  AVAILABLE = 'AVAILABLE', // Online, connected, 0 active orders (Include in assignment pool)
  BUSY = 'BUSY', // Currently handling an active order (Exclude from assignment pool)
  OFFLINE = 'OFFLINE', // Logged out or disconnected (Exclude from assignment pool)
}

/**
 * Optional helper interface to represent the full state of an agent in your system.
 */
export interface AgentState {
  agentId: string;
  //   connection: AgentConnectionState;
  availability: AgentAvailabilityStatus;
  currentOrderId: string | null; // null when AVAILABLE or OFFLINE
  currentOrderStatus: OrderStatus | null;
}

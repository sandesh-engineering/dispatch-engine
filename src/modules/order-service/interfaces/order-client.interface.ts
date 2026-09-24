export interface AssignDriverPayload {
  orderId: string;
  driverId: string;
  dispatchId?: string;
  assignedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface IOrderServiceClient {
  assignDriver(payload: AssignDriverPayload): Promise<void>;
}

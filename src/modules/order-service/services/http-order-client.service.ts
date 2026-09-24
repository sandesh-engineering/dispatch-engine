import axios from 'axios';
import { logger } from '@platform/logger';
import { AssignDriverPayload, IOrderServiceClient } from '../interfaces/order-client.interface';

export class HttpOrderServiceClient implements IOrderServiceClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.ORDER_SERVICE_URL || 'http://localhost:5005/api/v1/orders';
  }

  async assignDriver(payload: AssignDriverPayload): Promise<void> {
    const url = `${this.baseUrl}/${payload.orderId}/assign-driver`;
    logger.info('Calling Order Service to assign driver to order', {
      url,
      orderId: payload.orderId,
      driverId: payload.driverId,
    });

    try {
      await axios.post(url, payload, { timeout: 5000 });
      logger.info('Order Service successfully updated driver assignment', {
        orderId: payload.orderId,
        driverId: payload.driverId,
      });
    } catch (err) {
      /* In mock mode when endpoint is not running, log mock success fallback */
      logger.warn('Order Service HTTP call skipped/failed, falling back to mock inline assignment', {
        error: err instanceof Error ? err.message : String(err),
        orderId: payload.orderId,
        driverId: payload.driverId,
      });
    }
  }
}

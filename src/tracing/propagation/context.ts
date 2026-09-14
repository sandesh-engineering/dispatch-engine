import { context, propagation, ROOT_CONTEXT, trace, type Context } from '@platform/tracing';

export class ContextPropagation {
  static createCarrier() {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier;
  }

  static extractContext(carrier: Record<string, unknown>): Context {
    return propagation.extract(ROOT_CONTEXT, carrier as Record<string, string>);
  }
}

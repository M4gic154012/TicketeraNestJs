import { randomUUID } from 'node:crypto';
import { RequestContext } from '../context/request-context';
import { RPC_AUTH_FIELD } from '../guards/rpc-auth.guard';
import { RPC_CORRELATION_FIELD } from '../interceptors/rpc-correlation.interceptor';

/**
 * Adjunta el secreto compartido y el correlation-id activo al payload de un
 * mensaje RPC.
 *
 * Se centraliza acá para que ningún cliente pueda olvidarlo: si un `send` sale
 * sin el secreto, el destinatario lo rechaza y el error aparece en desarrollo,
 * no en producción. El correlation-id sale de `RequestContext`, poblado por
 * `CorrelationIdMiddleware` en el gateway o por `RpcCorrelationInterceptor` en
 * cada microservicio — así que ningún llamante de `withRpcAuth` tiene que
 * conocerlo ni pasarlo a mano; si no hay ninguno activo (un job del
 * scheduler, el poller de email-ingestion), se genera uno nuevo acá mismo.
 */
export function withRpcAuth<T>(payload: T, secret: string): T {
  const correlationId = RequestContext.correlationId ?? randomUUID();

  // El payload de un mensaje RPC siempre es un objeto en este sistema; si
  // llegara un escalar, se envuelve para no perder el secreto ni el correlation-id.
  if (typeof payload !== 'object' || payload === null) {
    return {
      value: payload,
      [RPC_AUTH_FIELD]: secret,
      [RPC_CORRELATION_FIELD]: correlationId,
    } as unknown as T;
  }

  return {
    ...payload,
    [RPC_AUTH_FIELD]: secret,
    [RPC_CORRELATION_FIELD]: correlationId,
  } as T;
}

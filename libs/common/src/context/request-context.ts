import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Correlation-id disponible durante todo el ciclo de vida de un request (HTTP
 * o RPC), sin pasarlo a mano por cada capa.
 *
 * `run` lo arma una sola vez, en el borde de cada proceso: el middleware HTTP
 * del gateway (`CorrelationIdMiddleware`) o el interceptor RPC de cada
 * microservicio (`RpcCorrelationInterceptor`). `correlationId` lo lee
 * cualquier código que corra dentro de ese `run` — en particular
 * `withRpcAuth`, que lo adjunta solo al mensaje saliente hacia el siguiente
 * proceso sin que el caller tenga que conocerlo ni reenviarlo.
 *
 * Si no hay ningún `run` activo (un job del scheduler, el poller de
 * email-ingestion), `correlationId` devuelve `undefined` y quien arma el
 * mensaje RPC genera uno nuevo: esa cadena queda igual de trazable entre los
 * servicios que toque, aunque no venga de un request HTTP.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
};

import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { RequestContext } from '../context/request-context';
import { withRpcAuth } from '../clients/rpc-sender';
import { RPC_CORRELATION_FIELD, RpcCorrelationInterceptor } from './rpc-correlation.interceptor';

/**
 * `RpcCorrelationInterceptor` es la mitad receptora de la propagación: recibe
 * lo que `withRpcAuth` adjuntó en el proceso anterior y lo deja disponible en
 * `RequestContext` para todo el handler, incluidas las llamadas RPC que ese
 * handler haga a su vez hacia otro servicio — que lo heredan sin que nadie
 * tenga que reenviarlo a mano.
 */
describe('RpcCorrelationInterceptor', () => {
  const secret = 'un-secreto-compartido-de-mas-de-32-caracteres';
  const interceptor = new RpcCorrelationInterceptor();

  const contextWith = (data: unknown): ExecutionContext =>
    ({
      switchToRpc: () => ({ getData: () => data }),
      getClass: () => ({ name: 'ServicioDePrueba' }),
      getHandler: () => ({ name: 'handlerDePrueba' }),
    }) as unknown as ExecutionContext;

  const handlerThatReturns = (fn: () => unknown): CallHandler => ({
    handle: () => of(fn()),
  });

  it('toma el correlation-id del mensaje entrante y lo deja en RequestContext durante el handler', (done) => {
    const payload = { id: '1', [RPC_CORRELATION_FIELD]: 'req-heredado' };
    let seenDuringHandler: string | undefined;

    interceptor
      .intercept(
        contextWith(payload),
        handlerThatReturns(() => {
          seenDuringHandler = RequestContext.correlationId;
          return 'ok';
        }),
      )
      .subscribe({
        complete: () => {
          expect(seenDuringHandler).toBe('req-heredado');
          done();
        },
      });
  });

  it('limpia el campo de correlación del payload antes de que llegue al handler', (done) => {
    const payload: Record<string, unknown> = { id: '1', [RPC_CORRELATION_FIELD]: 'req-1' };

    interceptor.intercept(contextWith(payload), handlerThatReturns(() => 'ok')).subscribe({
      complete: () => {
        expect(payload[RPC_CORRELATION_FIELD]).toBeUndefined();
        expect(payload.id).toBe('1');
        done();
      },
    });
  });

  it('si el mensaje no trae correlation-id, genera uno nuevo en vez de dejar el handler sin contexto', (done) => {
    let seenDuringHandler: string | undefined;

    interceptor
      .intercept(
        contextWith({ id: '1' }),
        handlerThatReturns(() => {
          seenDuringHandler = RequestContext.correlationId;
          return 'ok';
        }),
      )
      .subscribe({
        complete: () => {
          expect(seenDuringHandler).toBeTruthy();
          done();
        },
      });
  });

  it('un handler que reenvía la llamada a otro servicio hereda el mismo correlation-id sin pasarlo a mano', (done) => {
    const incoming = { id: '1', [RPC_CORRELATION_FIELD]: 'req-cadena' };

    interceptor
      .intercept(
        contextWith(incoming),
        handlerThatReturns(() => withRpcAuth({ nextCall: true }, secret)),
      )
      .subscribe({
        next: (outgoing) => {
          expect((outgoing as Record<string, unknown>)[RPC_CORRELATION_FIELD]).toBe(
            'req-cadena',
          );
        },
        complete: done,
      });
  });
});

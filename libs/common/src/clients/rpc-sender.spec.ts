import { RPC_AUTH_FIELD } from '../guards/rpc-auth.guard';
import { RPC_CORRELATION_FIELD } from '../interceptors/rpc-correlation.interceptor';
import { RequestContext } from '../context/request-context';
import { withRpcAuth } from './rpc-sender';

describe('withRpcAuth', () => {
  const secret = 'un-secreto-compartido-de-mas-de-32-caracteres';

  it('adjunta el secreto', () => {
    const message = withRpcAuth({ id: '1' }, secret) as Record<string, unknown>;
    expect(message[RPC_AUTH_FIELD]).toBe(secret);
  });

  it('sin un RequestContext activo, genera un correlation-id nuevo', () => {
    const message = withRpcAuth({ id: '1' }, secret) as Record<string, unknown>;
    expect(typeof message[RPC_CORRELATION_FIELD]).toBe('string');
    expect((message[RPC_CORRELATION_FIELD] as string).length).toBeGreaterThan(0);
  });

  it('dentro de un RequestContext, adjunta ese mismo correlation-id sin que el llamante lo pase', () => {
    RequestContext.run({ correlationId: 'req-abc-123' }, () => {
      const message = withRpcAuth({ id: '1' }, secret) as Record<string, unknown>;
      expect(message[RPC_CORRELATION_FIELD]).toBe('req-abc-123');
    });
  });

  it('dos llamadas dentro del mismo contexto comparten el correlation-id', () => {
    RequestContext.run({ correlationId: 'req-xyz' }, () => {
      const a = withRpcAuth({ id: 'a' }, secret) as Record<string, unknown>;
      const b = withRpcAuth({ id: 'b' }, secret) as Record<string, unknown>;
      expect(a[RPC_CORRELATION_FIELD]).toBe('req-xyz');
      expect(b[RPC_CORRELATION_FIELD]).toBe('req-xyz');
    });
  });

  it('un payload escalar se envuelve sin perder ni el secreto ni el correlation-id', () => {
    RequestContext.run({ correlationId: 'req-escalar' }, () => {
      const message = withRpcAuth('solo-un-string', secret) as unknown as Record<
        string,
        unknown
      >;
      expect(message.value).toBe('solo-un-string');
      expect(message[RPC_AUTH_FIELD]).toBe(secret);
      expect(message[RPC_CORRELATION_FIELD]).toBe('req-escalar');
    });
  });
});

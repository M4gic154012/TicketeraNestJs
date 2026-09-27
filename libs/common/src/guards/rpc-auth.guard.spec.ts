import { ConfigService } from '@nestjs/config';
import { ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RPC_AUTH_FIELD, RpcAuthGuard } from './rpc-auth.guard';

/**
 * Regresión del acceso directo a los puertos internos.
 *
 * Un pentest demostró que hablando el protocolo TCP de Nest contra el puerto de
 * users-service se podía crear un usuario ADMIN, salteándose por completo los
 * guards del gateway. Este guard es la defensa de aplicación; falla cerrado.
 */
describe('RpcAuthGuard', () => {
  const secret = 'un-secreto-compartido-de-mas-de-32-caracteres';
  const config = { getOrThrow: () => secret } as unknown as ConfigService;
  const guard = new RpcAuthGuard(config);

  const contextWith = (data: unknown): ExecutionContext =>
    ({
      switchToRpc: () => ({ getData: () => data }),
      getHandler: () => ({ name: 'handlerDePrueba' }),
    }) as unknown as ExecutionContext;

  it('acepta un mensaje con el secreto correcto', () => {
    expect(guard.canActivate(contextWith({ id: '1', [RPC_AUTH_FIELD]: secret }))).toBe(true);
  });

  it('rechaza un mensaje sin secreto', () => {
    expect(() => guard.canActivate(contextWith({ id: '1' }))).toThrow(RpcException);
  });

  it('rechaza un secreto incorrecto del mismo largo', () => {
    const wrong = 'X'.repeat(secret.length);
    expect(() => guard.canActivate(contextWith({ [RPC_AUTH_FIELD]: wrong }))).toThrow(
      RpcException,
    );
  });

  it('rechaza un secreto de largo distinto', () => {
    expect(() => guard.canActivate(contextWith({ [RPC_AUTH_FIELD]: 'corto' }))).toThrow(
      RpcException,
    );
  });

  it('rechaza un payload vacío', () => {
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(RpcException);
  });

  it('rechaza un secreto que no es string', () => {
    expect(() => guard.canActivate(contextWith({ [RPC_AUTH_FIELD]: 12345 }))).toThrow(
      RpcException,
    );
  });

  it('elimina el campo del payload para que no llegue al negocio ni al log', () => {
    const payload: Record<string, unknown> = { id: '1', [RPC_AUTH_FIELD]: secret };

    guard.canActivate(contextWith(payload));

    expect(payload[RPC_AUTH_FIELD]).toBeUndefined();
    expect(payload.id).toBe('1');
  });

  it('el error rechazado lleva httpStatus 401 para que el borde lo traduzca', () => {
    try {
      guard.canActivate(contextWith({}));
      fail('debía lanzar');
    } catch (error) {
      expect((error as RpcException).getError()).toMatchObject({
        code: 'RPC_UNAUTHENTICATED',
        httpStatus: 401,
      });
    }
  });
});

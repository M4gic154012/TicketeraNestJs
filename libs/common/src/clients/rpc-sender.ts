import { RPC_AUTH_FIELD } from '../guards/rpc-auth.guard';

/**
 * Adjunta el secreto compartido al payload de un mensaje RPC.
 *
 * Se centraliza acá para que ningún cliente pueda olvidarlo: si un `send` sale
 * sin el secreto, el destinatario lo rechaza y el error aparece en desarrollo,
 * no en producción.
 */
export function withRpcAuth<T>(payload: T, secret: string): T {
  // El payload de un mensaje RPC siempre es un objeto en este sistema; si
  // llegara un escalar, se envuelve para no perder el secreto.
  if (typeof payload !== 'object' || payload === null) {
    return { value: payload, [RPC_AUTH_FIELD]: secret } as unknown as T;
  }

  return { ...payload, [RPC_AUTH_FIELD]: secret } as T;
}

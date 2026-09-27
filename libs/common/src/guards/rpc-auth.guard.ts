import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { timingSafeEqual } from 'node:crypto';

/** Campo que transporta el secreto en cada mensaje RPC. */
export const RPC_AUTH_FIELD = '__rpcToken';

/**
 * Autenticación entre servicios.
 *
 * El modelo "solo el gateway está expuesto" depende de un firewall. Esto es la
 * defensa en profundidad a nivel de aplicación: sin el secreto compartido, un
 * mensaje que llegue directo a un puerto TCP interno se rechaza, aunque quien lo
 * envíe tenga acceso de red.
 *
 * Falla cerrado: si el mensaje no trae el secreto, se rechaza. Sin esto, hablar
 * el protocolo TCP contra el puerto de users-service permitía crear un usuario
 * ADMIN salteándose el guard de roles del gateway.
 */
@Injectable()
export class RpcAuthGuard implements CanActivate {
  private readonly logger = new Logger(RpcAuthGuard.name);
  private readonly expected: Buffer;

  constructor(config: ConfigService) {
    this.expected = Buffer.from(config.getOrThrow<string>('RPC_SHARED_SECRET'));
  }

  canActivate(context: ExecutionContext): boolean {
    const payload = context.switchToRpc().getData() as Record<string, unknown> | undefined;
    const provided = payload?.[RPC_AUTH_FIELD];

    if (typeof provided !== 'string' || !this.matches(provided)) {
      this.logger.warn(
        `Mensaje RPC rechazado por secreto inválido en '${context.getHandler().name}'`,
      );
      throw new RpcException({
        code: 'RPC_UNAUTHENTICATED',
        message: 'Mensaje interno no autenticado',
        httpStatus: 401,
      });
    }

    // El campo de autenticación no debe llegar a la lógica de negocio ni a un
    // log de payload. `payload` existe: si fuera undefined, `provided` no sería
    // un string y la comprobación de arriba ya habría rechazado el mensaje.
    delete payload![RPC_AUTH_FIELD];
    return true;
  }

  /** Comparación en tiempo constante: un `===` filtra el secreto por timing. */
  private matches(provided: string): boolean {
    const candidate = Buffer.from(provided);
    if (candidate.length !== this.expected.length) return false;
    return timingSafeEqual(candidate, this.expected);
  }
}

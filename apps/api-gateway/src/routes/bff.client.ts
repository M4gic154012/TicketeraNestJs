import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import {
  BFF_WEB_SERVICE,
  NOTIFICATIONS_SERVICE,
  TICKETS_SERVICE,
  USERS_SERVICE,
  withRpcAuth,
} from '@ticketera/common';
import { CircuitBreakerRegistry } from '@ticketera/patterns';
import { firstValueFrom, timeout } from 'rxjs';

/**
 * Salida del gateway hacia adentro.
 *
 * Las lecturas de pantalla van al BFF (que compone); las escrituras simples van
 * directo al servicio dueño, porque pasar por el BFF solo agregaría un salto sin
 * aportar composición.
 *
 * Todo pasa por circuit breaker: el gateway es el borde y es lo último que debe
 * caerse cuando falla algo adentro.
 */
@Injectable()
export class UpstreamClient {
  constructor(
    @Inject(BFF_WEB_SERVICE) private readonly bff: ClientProxy,
    @Inject(TICKETS_SERVICE) private readonly tickets: ClientProxy,
    @Inject(USERS_SERVICE) private readonly users: ClientProxy,
    @Inject(NOTIFICATIONS_SERVICE) private readonly notifications: ClientProxy,
    private readonly breakers: CircuitBreakerRegistry,
    config: ConfigService,
  ) {
    this.rpcSecret = config.getOrThrow<string>('RPC_SHARED_SECRET');
  }

  private readonly rpcSecret: string;

  toBff<T>(pattern: string, payload: unknown): Promise<T> {
    return this.send('bff-web', this.bff, pattern, payload);
  }

  toTickets<T>(pattern: string, payload: unknown): Promise<T> {
    return this.send('tickets-service', this.tickets, pattern, payload);
  }

  toUsers<T>(pattern: string, payload: unknown): Promise<T> {
    return this.send('users-service', this.users, pattern, payload);
  }

  toNotifications<T>(pattern: string, payload: unknown): Promise<T> {
    return this.send('notifications-service', this.notifications, pattern, payload);
  }

  circuits() {
    return this.breakers.snapshots();
  }

  private send<T>(
    serviceName: string,
    client: ClientProxy,
    pattern: string,
    payload: unknown,
  ): Promise<T> {
    const breaker = this.breakers.get(serviceName, { timeoutMs: 8_000 });
    // Sin fallback a propósito: el gateway no inventa datos. Si el circuito está
    // abierto, el cliente recibe 503 y sabe que debe reintentar.
    return breaker.execute(() =>
      firstValueFrom(
        client.send<T>(pattern, withRpcAuth(payload, this.rpcSecret)).pipe(timeout(8_000)),
      ),
    );
  }
}

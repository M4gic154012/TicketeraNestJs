import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFICATIONS_SERVICE,
  TICKETS_SERVICE,
  USERS_SERVICE,
  withRpcAuth,
} from '@ticketera/common';
import { CircuitBreakerRegistry } from '@ticketera/patterns';
import { firstValueFrom, timeout } from 'rxjs';

/**
 * Único punto de salida del BFF hacia los microservicios.
 *
 * Cada llamada pasa por el circuit breaker del servicio destino: el BFF compone
 * varias respuestas, así que un dependiente lento sin protección degradaría todas
 * las pantallas, no solo la suya.
 */
@Injectable()
export class ServiceClients {
  private readonly logger = new Logger(ServiceClients.name);

  constructor(
    @Inject(TICKETS_SERVICE) private readonly ticketsClient: ClientProxy,
    @Inject(USERS_SERVICE) private readonly usersClient: ClientProxy,
    @Inject(NOTIFICATIONS_SERVICE) private readonly notificationsClient: ClientProxy,
    private readonly breakers: CircuitBreakerRegistry,
    config: ConfigService,
  ) {
    this.rpcSecret = config.getOrThrow<string>('RPC_SHARED_SECRET');
  }

  private readonly rpcSecret: string;

  /**
   * @param fallback si se provee, la llamada degrada en vez de propagar el
   *   error. Úsalo solo para datos accesorios de una pantalla.
   */
  tickets<T>(pattern: string, payload: unknown, fallback?: () => T): Promise<T> {
    return this.call('tickets-service', this.ticketsClient, pattern, payload, fallback);
  }

  users<T>(pattern: string, payload: unknown, fallback?: () => T): Promise<T> {
    return this.call('users-service', this.usersClient, pattern, payload, fallback);
  }

  notifications<T>(pattern: string, payload: unknown, fallback?: () => T): Promise<T> {
    return this.call(
      'notifications-service',
      this.notificationsClient,
      pattern,
      payload,
      fallback,
    );
  }

  private call<T>(
    serviceName: string,
    client: ClientProxy,
    pattern: string,
    payload: unknown,
    fallback?: () => T,
  ): Promise<T> {
    const breaker = this.breakers.get(serviceName);

    return breaker.execute(
      () =>
        firstValueFrom(
          client.send<T>(pattern, withRpcAuth(payload, this.rpcSecret)).pipe(timeout(5_000)),
        ),
      fallback
        ? async (error) => {
            this.logger.warn(
              `${serviceName}/${pattern} degradado: ${error.message}`,
            );
            return fallback();
          }
        : undefined,
    );
  }

  /** Estado de los circuitos, expuesto por el gateway en /health. */
  circuitSnapshots() {
    return this.breakers.snapshots();
  }
}

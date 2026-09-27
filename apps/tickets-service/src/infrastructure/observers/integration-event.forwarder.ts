import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { NOTIFICATIONS_PATTERNS, NOTIFICATIONS_SERVICE, withRpcAuth } from '@ticketera/common';
import { CircuitBreakerRegistry, DomainEvent } from '@ticketera/patterns';
import { firstValueFrom } from 'rxjs';

/**
 * Observador que traduce eventos de dominio locales en eventos de integración.
 *
 * Es el único punto del servicio de tickets que conoce a notifications-service:
 * el dominio emite `ticket.assigned` sin saber quién escucha, y este adaptador
 * lo saca por el transporte. Agregar un consumidor nuevo (analítica, webhooks de
 * clientes) no obliga a tocar ni el dominio ni los casos de uso.
 *
 * Se usa `emit` y no `send`: es fire-and-forget, notificar no debe bloquear la
 * respuesta al usuario que acaba de crear el ticket.
 */
@Injectable()
export class IntegrationEventForwarder {
  private readonly logger = new Logger(IntegrationEventForwarder.name);

  constructor(
    @Inject(NOTIFICATIONS_SERVICE) private readonly notifications: ClientProxy,
    private readonly breakers: CircuitBreakerRegistry,
    config: ConfigService,
  ) {
    this.rpcSecret = config.getOrThrow<string>('RPC_SHARED_SECRET');
  }

  private readonly rpcSecret: string;

  // Un solo handler con comodín: cualquier evento `ticket.*` se reenvía, así un
  // evento nuevo no requiere registrar otro observador acá.
  @OnEvent('ticket.*', { async: true, promisify: true })
  async forward(event: DomainEvent): Promise<void> {
    const breaker = this.breakers.get('notifications-service', {
      // Notificar es secundario: si el servicio está caído, abrir rápido y
      // dejar de intentar es mejor que retener recursos del servicio de tickets.
      failureThresholdPercentage: 40,
      timeoutMs: 2_000,
    });

    await breaker.execute(
      () =>
        firstValueFrom(
          this.notifications.emit(
            NOTIFICATIONS_PATTERNS.domainEvent,
            withRpcAuth(event.toIntegrationMessage(), this.rpcSecret),
          ),
        ),
      async (error) => {
        // Se pierde la notificación, no el ticket. Queda registrado para poder
        // reprocesar; un outbox persistente es el siguiente paso natural acá.
        this.logger.error(
          `No se pudo reenviar ${event.eventName} (${event.eventId}): ${error.message}`,
        );
      },
    );
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { USERS_PATTERNS, USERS_SERVICE, withRpcAuth } from '@ticketera/common';
import { IntegrationEventMessage, ApplicationService, CircuitBreakerRegistry } from '@ticketera/patterns';
import { firstValueFrom, timeout } from 'rxjs';
import { NotificationFactory } from '../../domain/factories';
import { ChannelStrategyResolver } from '../../domain/strategies';
import { NotificationsRepository } from '../../infrastructure/repositories';

export interface HandleEventResult {
  created: number;
  delivered: number;
  skipped: number;
}

/**
 * Caso de uso: procesar un evento de integración.
 *
 * Es el extremo receptor del Observer. El flujo es: factory decide qué
 * notificaciones corresponden, se insertan de forma idempotente, y la estrategia
 * de canal entrega cada una. Un fallo de entrega no descarta la notificación:
 * queda registrada con su error para poder reintentarla.
 */
@Injectable()
export class HandleDomainEventUseCase extends ApplicationService<
  IntegrationEventMessage,
  HandleEventResult
> {
  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly factory: NotificationFactory,
    private readonly channels: ChannelStrategyResolver,
    private readonly breakers: CircuitBreakerRegistry,
    @Inject(USERS_SERVICE) private readonly users: ClientProxy,
    config: ConfigService,
  ) {
    super();
    this.rpcSecret = config.getOrThrow<string>('RPC_SHARED_SECRET');
  }

  private readonly rpcSecret: string;

  async execute(event: IntegrationEventMessage): Promise<HandleEventResult> {
    const candidates = this.factory.createFrom(event);

    if (candidates.length === 0) {
      this.logger.debug(`Evento ${event.eventName} sin notificaciones asociadas`);
      return { created: 0, delivered: 0, skipped: 0 };
    }

    const created = await this.notifications.insertIgnoringDuplicates(candidates);
    const skipped = candidates.length - created.length;

    if (skipped > 0) {
      this.logger.debug(`${skipped} notificaciones ya existían para el evento ${event.eventId}`);
    }

    const emailsByRecipient = await this.resolveEmails(
      [...new Set(created.map((n) => n.recipientId))],
    );

    let delivered = 0;
    for (const notification of created) {
      const recipientEmail = emailsByRecipient.get(notification.recipientId) ?? null;

      try {
        const result = await this.channels.deliver({ notification, recipientEmail });
        if (result.delivered) delivered++;
      } catch (error) {
        notification.markFailed((error as Error).message);
        this.logger.error(
          `Entrega fallida de ${notification.id} por ${notification.channel}: ${(error as Error).message}`,
        );
      }

      // Se guarda siempre: interesa registrar tanto el envío como el intento
      // fallido con su error.
      await this.notifications.save(notification);
    }

    return { created: created.length, delivered, skipped };
  }

  /**
   * Los emails de los destinatarios viven en users-service. Antes se pedía uno
   * por notificación (N llamadas RPC, con el mismo destinatario pedido dos veces
   * cuando el solicitante y el asignado coinciden); acá se piden todos los ids
   * únicos en una sola llamada. Si el servicio no responde, todos los
   * destinatarios de este lote se degradan al canal in-app en vez de perderse.
   */
  private async resolveEmails(recipientIds: string[]): Promise<Map<string, string>> {
    if (recipientIds.length === 0) return new Map();

    const breaker = this.breakers.get('users-service', { timeoutMs: 2_000 });

    const users = await breaker.execute(
      async () =>
        firstValueFrom(
          this.users
            .send<{ id: string; email: string }[]>(
              USERS_PATTERNS.findMany,
              withRpcAuth({ ids: recipientIds }, this.rpcSecret),
            )
            .pipe(timeout(2_000)),
        ),
      async () => {
        this.logger.warn(
          `Sin emails para ${recipientIds.length} destinatario(s): se degradan a bandeja in-app`,
        );
        return [];
      },
    );

    return new Map(users.map((user) => [user.id, user.email]));
  }
}

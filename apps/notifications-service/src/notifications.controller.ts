import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, MessagePattern, Payload, TcpContext } from '@nestjs/microservices';
import { NOTIFICATIONS_PATTERNS } from '@ticketera/common';
import { IntegrationEventMessage } from '@ticketera/patterns';
import {
  HandleDomainEventUseCase,
  ListNotificationsQuery,
  ListNotificationsUseCase,
  MarkAsReadCommand,
  MarkAsReadUseCase,
  NotificationListView,
} from './application/use-cases';

@Controller()
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly handleEvent: HandleDomainEventUseCase,
    private readonly listNotifications: ListNotificationsUseCase,
    private readonly markAsRead: MarkAsReadUseCase,
  ) {}

  /**
   * @EventPattern y no @MessagePattern: el emisor usa `emit` y no espera
   * respuesta. Un error acá no debe propagarse al servicio de tickets, así que se
   * captura y se registra.
   */
  @EventPattern(NOTIFICATIONS_PATTERNS.domainEvent)
  async onDomainEvent(
    @Payload() event: IntegrationEventMessage,
    @Ctx() _context: TcpContext,
  ): Promise<void> {
    try {
      const result = await this.handleEvent.execute(event);
      this.logger.debug(
        `${event.eventName}: ${result.created} creadas, ${result.delivered} entregadas, ${result.skipped} duplicadas`,
      );
    } catch (error) {
      this.logger.error(
        `Fallo procesando ${event.eventName} (${event.eventId}): ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  @MessagePattern(NOTIFICATIONS_PATTERNS.findForUser)
  findForUser(@Payload() query: ListNotificationsQuery): Promise<NotificationListView> {
    return this.listNotifications.execute(query);
  }

  @MessagePattern(NOTIFICATIONS_PATTERNS.markAsRead)
  markRead(@Payload() command: MarkAsReadCommand): Promise<{ updated: number }> {
    return this.markAsRead.execute(command);
  }
}

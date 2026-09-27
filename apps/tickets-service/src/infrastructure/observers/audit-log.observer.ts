import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TICKET_EVENTS, TicketStatusChangedEvent } from '@ticketera/common';
import { DomainEvent } from '@ticketera/patterns';

/**
 * Segundo observador sobre los mismos eventos: bitácora de auditoría.
 *
 * Demuestra el valor del patrón — este archivo se agregó sin modificar una sola
 * línea del dominio ni de los casos de uso que producen los eventos.
 */
@Injectable()
export class AuditLogObserver {
  private readonly logger = new Logger('Auditoría');

  @OnEvent('ticket.*', { async: true, promisify: true })
  async record(event: DomainEvent): Promise<void> {
    this.logger.log({
      eventName: event.eventName,
      eventId: event.eventId,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt.toISOString(),
      ...event.payload(),
    });
  }

  /** Los cierres y reaperturas se destacan por ser los más auditados. */
  @OnEvent(TICKET_EVENTS.statusChanged, { async: true, promisify: true })
  async highlightStatusChange(event: TicketStatusChangedEvent): Promise<void> {
    const { fromStatus, toStatus, code } = event.payload() as Record<string, string>;
    this.logger.log(`${code}: ${fromStatus} -> ${toStatus}`);
  }
}

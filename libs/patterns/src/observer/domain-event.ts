import { randomUUID } from 'node:crypto';

/**
 * Evento de dominio: un hecho que ya ocurrió, nombrado en pasado
 * (`ticket.created`, no `create.ticket`). Es inmutable.
 */
export abstract class DomainEvent {
  readonly eventId: string = randomUUID();
  readonly occurredAt: Date = new Date();

  /** Nombre del canal. Convención: `<agregado>.<hecho-en-pasado>`. */
  abstract readonly eventName: string;

  /** Id del agregado que originó el evento, para trazabilidad y auditoría. */
  abstract readonly aggregateId: string;

  /** Payload serializable que viaja a otros servicios. */
  abstract payload(): Record<string, unknown>;

  toIntegrationMessage(): IntegrationEventMessage {
    return {
      eventId: this.eventId,
      eventName: this.eventName,
      aggregateId: this.aggregateId,
      occurredAt: this.occurredAt.toISOString(),
      payload: this.payload(),
    };
  }
}

export interface IntegrationEventMessage {
  eventId: string;
  eventName: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

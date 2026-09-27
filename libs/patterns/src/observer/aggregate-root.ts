import { DomainEvent } from './domain-event';

/**
 * Patrón Observer, lado sujeto.
 *
 * El agregado no publica sus eventos: los acumula. La capa de aplicación los
 * drena y publica DESPUÉS de que la transacción hizo commit. Publicar dentro
 * de la transacción es el error clásico: los observadores reaccionan a un
 * cambio que todavía puede hacer rollback.
 */
export abstract class AggregateRoot {
  private domainEvents: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  /** Devuelve los eventos pendientes y limpia el buffer. */
  pullDomainEvents(): DomainEvent[] {
    const events = this.domainEvents;
    this.domainEvents = [];
    return events;
  }

  hasPendingEvents(): boolean {
    return this.domainEvents.length > 0;
  }
}

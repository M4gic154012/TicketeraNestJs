import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AggregateRoot } from './aggregate-root';
import { DomainEvent } from './domain-event';

/**
 * Patrón Observer, lado difusor.
 *
 * Desacopla al emisor de sus observadores: el servicio de tickets no conoce a
 * notificaciones ni a auditoría, solo anuncia el hecho. Sumar un observador
 * nuevo no toca el emisor.
 *
 * Un observador que falla NO debe tumbar la operación que ya se confirmó, por
 * eso cada entrega se aísla y se registra.
 *
 * `publish` no espera a que los observadores terminen: `emitAsync` de
 * eventemitter2 devuelve `Promise.all(...)` de lo que cada listener retorna sin
 * importar sus opciones (`async`/`promisify` solo cambian si se difiere a
 * `setImmediate`, no si `emitAsync` lo espera) — así que esperarlo acá bloquearía
 * la respuesta al usuario con la latencia de red de cada observador (p. ej. el
 * RPC a notifications-service). Eso es justo lo que "fire-and-forget" dice
 * evitar: notificar no debe demorar la escritura que el usuario ya confirmó.
 */
@Injectable()
export class DomainEventPublisher {
  private readonly logger = new Logger(DomainEventPublisher.name);

  constructor(private readonly emitter: EventEmitter2) {}

  async publish(event: DomainEvent): Promise<void> {
    this.logger.debug(`Publicando ${event.eventName} (${event.aggregateId})`);

    // No se espera: ver el comentario de la clase. Cada observador aísla sus
    // propios fallos (p. ej. IntegrationEventForwarder con su propio fallback);
    // este catch es la red de contención para el que no lo haga.
    this.emitter.emitAsync(event.eventName, event).catch((error) => {
      this.logger.error(
        `Observador de ${event.eventName} falló: ${(error as Error).message}`,
        (error as Error).stack,
      );
    });
  }

  /** Drena y publica todo lo acumulado por el agregado. */
  async publishFrom(aggregate: AggregateRoot): Promise<void> {
    for (const event of aggregate.pullDomainEvents()) {
      await this.publish(event);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { ApplicationService, DomainEventPublisher } from '@ticketera/patterns';
import { TicketsRepository } from '../../infrastructure/repositories';

export interface SweepSlaResult {
  scanned: number;
  newlyBreached: number;
  /** true si quedaron candidatos sin procesar por el tope del lote. */
  truncated: boolean;
}

/**
 * Caso de uso: barrido de SLA vencidos.
 *
 * Lo dispara el scheduler del servicio. Marca el incumplimiento una sola vez por
 * ticket (`slaBreached`) para que el observador de notificaciones no avise el
 * mismo vencimiento en cada corrida.
 */
@Injectable()
export class SweepSlaBreachesUseCase extends ApplicationService<void, SweepSlaResult> {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly events: DomainEventPublisher,
  ) {
    super();
  }

  /**
   * Tope por corrida. Acota la memoria del proceso y la duración de la consulta:
   * el resto se procesa en la corrida siguiente, cinco minutos después, que para
   * una alerta de SLA es una demora aceptable.
   */
  private static readonly BATCH_SIZE = 200;

  async execute(): Promise<SweepSlaResult> {
    const now = new Date();

    // `onlyUnmarked` filtra en SQL: la consulta devuelve incumplimientos nuevos,
    // no el backlog completo de vencidos abiertos.
    const overdue = await this.tickets.findOverdueUnmarked(
      now,
      SweepSlaBreachesUseCase.BATCH_SIZE,
    );

    let newlyBreached = 0;

    for (const ticket of overdue) {
      ticket.markSlaBreached(now);
      if (!ticket.hasPendingEvents()) continue;

      // Se guarda y publica ticket por ticket: si uno falla (p. ej. conflicto de
      // versión por una edición concurrente) el resto del barrido sigue.
      try {
        const saved = await this.tickets.save(ticket);
        await this.events.publishFrom(saved);
        newlyBreached++;
      } catch (error) {
        this.logger.error(
          `No se pudo marcar SLA vencido en ${ticket.code}: ${(error as Error).message}`,
        );
      }
    }

    if (newlyBreached > 0) {
      this.logger.warn(`${newlyBreached} tickets incumplieron su SLA`);
    }

    return {
      scanned: overdue.length,
      newlyBreached,
      truncated: overdue.length === SweepSlaBreachesUseCase.BATCH_SIZE,
    };
  }
}

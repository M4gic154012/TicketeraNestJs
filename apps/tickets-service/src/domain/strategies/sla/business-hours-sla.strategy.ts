import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketPriority } from '@ticketera/common';
import { PrioritizedStrategy } from '@ticketera/patterns';
import { SlaContext, SlaResult, SlaStrategy } from './sla.types';

/**
 * SLA en horario laboral: los minutos se consumen solo de lunes a viernes entre
 * 09:00 y 18:00. Un ticket de prioridad baja abierto un viernes a las 17:50 no
 * debería vencer el sábado a la madrugada.
 *
 * Es la política por defecto para todo lo que no sea crítico.
 */
@Injectable()
export class BusinessHoursSlaStrategy
  implements SlaStrategy, PrioritizedStrategy<SlaContext, SlaResult>
{
  readonly name = 'business-hours';
  readonly priority = 10;

  private readonly workdayStartHour = 9;
  private readonly workdayEndHour = 18;

  constructor(private readonly config: ConfigService) {}

  supports(context: SlaContext): boolean {
    return context.priority !== TicketPriority.CRITICAL;
  }

  execute(context: SlaContext): SlaResult {
    const minutes = this.minutesFor(context.priority);
    return {
      dueAt: this.addBusinessMinutes(context.createdAt, minutes),
      minutes,
      policyName: this.name,
    };
  }

  private minutesFor(priority: TicketPriority): number {
    const byPriority: Record<TicketPriority, string> = {
      [TicketPriority.CRITICAL]: 'SLA_CRITICAL_MINUTES',
      [TicketPriority.HIGH]: 'SLA_HIGH_MINUTES',
      [TicketPriority.MEDIUM]: 'SLA_MEDIUM_MINUTES',
      [TicketPriority.LOW]: 'SLA_LOW_MINUTES',
    };
    return this.config.get<number>(byPriority[priority]) ?? 1440;
  }

  /**
   * Avanza `minutes` saltando noches y fines de semana. Se itera en tramos de
   * jornada en lugar de minuto a minuto para que un SLA de 3 días no signifique
   * 4320 iteraciones.
   */
  private addBusinessMinutes(from: Date, minutes: number): Date {
    let cursor = this.nextBusinessMoment(new Date(from));
    let remaining = minutes;

    while (remaining > 0) {
      const endOfDay = new Date(cursor);
      endOfDay.setHours(this.workdayEndHour, 0, 0, 0);

      const availableToday = Math.floor((endOfDay.getTime() - cursor.getTime()) / 60_000);

      if (remaining <= availableToday) {
        return new Date(cursor.getTime() + remaining * 60_000);
      }

      remaining -= availableToday;
      cursor = this.nextBusinessMoment(this.startOfNextDay(cursor));
    }

    return cursor;
  }

  /** Si cae fuera de horario, mueve al próximo inicio de jornada hábil. */
  private nextBusinessMoment(date: Date): Date {
    const cursor = new Date(date);

    for (let guard = 0; guard < 14; guard++) {
      const day = cursor.getDay();
      const isWeekend = day === 0 || day === 6;

      if (isWeekend) {
        this.moveToStartOfNextDay(cursor);
        continue;
      }
      if (cursor.getHours() < this.workdayStartHour) {
        cursor.setHours(this.workdayStartHour, 0, 0, 0);
        return cursor;
      }
      if (cursor.getHours() >= this.workdayEndHour) {
        this.moveToStartOfNextDay(cursor);
        continue;
      }
      return cursor;
    }

    return cursor;
  }

  private startOfNextDay(date: Date): Date {
    const next = new Date(date);
    this.moveToStartOfNextDay(next);
    return next;
  }

  private moveToStartOfNextDay(date: Date): void {
    date.setDate(date.getDate() + 1);
    date.setHours(this.workdayStartHour, 0, 0, 0);
  }
}

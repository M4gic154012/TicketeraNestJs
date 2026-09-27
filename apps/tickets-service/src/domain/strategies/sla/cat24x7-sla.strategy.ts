import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketPriority } from '@ticketera/common';
import { PrioritizedStrategy } from '@ticketera/patterns';
import { SlaContext, SlaResult, SlaStrategy } from './sla.types';

/**
 * SLA 24x7 en tiempo corrido: aplica a tickets críticos y a solicitantes VIP.
 * Una caída de producción no espera al lunes.
 */
@Injectable()
export class Sla24x7Strategy implements SlaStrategy, PrioritizedStrategy<SlaContext, SlaResult> {
  readonly name = '24x7';
  readonly priority = 50;

  constructor(private readonly config: ConfigService) {}

  supports(context: SlaContext): boolean {
    return context.priority === TicketPriority.CRITICAL || context.isVipRequester;
  }

  execute(context: SlaContext): SlaResult {
    const minutes = this.minutesFor(context.priority);
    return {
      dueAt: new Date(context.createdAt.getTime() + minutes * 60_000),
      minutes,
      policyName: this.name,
    };
  }

  private minutesFor(priority: TicketPriority): number {
    const keys: Record<TicketPriority, string> = {
      [TicketPriority.CRITICAL]: 'SLA_CRITICAL_MINUTES',
      [TicketPriority.HIGH]: 'SLA_HIGH_MINUTES',
      [TicketPriority.MEDIUM]: 'SLA_MEDIUM_MINUTES',
      [TicketPriority.LOW]: 'SLA_LOW_MINUTES',
    };
    return this.config.get<number>(keys[priority]) ?? 60;
  }
}

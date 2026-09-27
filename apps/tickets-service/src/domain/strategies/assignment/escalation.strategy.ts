import { Injectable } from '@nestjs/common';
import { TicketPriority, UserRole } from '@ticketera/common';
import { PrioritizedStrategy } from '@ticketera/patterns';
import { AssignmentContext, AssignmentResult, AssignmentStrategy } from './assignment.types';

/**
 * Los tickets CRÍTICOS van a un supervisor con capacidad, no a la cola general.
 *
 * Prioridad más alta que skill-based a propósito: ante una caída crítica importa
 * más quién puede escalar y coordinar que quién domina la categoría.
 */
@Injectable()
export class EscalationAssignmentStrategy
  implements AssignmentStrategy, PrioritizedStrategy<AssignmentContext, AssignmentResult | null>
{
  readonly name = 'escalation';
  readonly priority = 50;

  supports(context: AssignmentContext): boolean {
    return (
      context.priority === TicketPriority.CRITICAL &&
      context.candidates.some((c) => this.isSupervisor(c.agent.role))
    );
  }

  execute(context: AssignmentContext): AssignmentResult | null {
    const supervisors = context.candidates
      .filter((c) => this.isSupervisor(c.agent.role))
      .sort((a, b) => a.openTickets - b.openTickets);

    const chosen = supervisors[0];
    if (!chosen) return null;

    return {
      assignee: chosen.agent,
      rationale: `Ticket crítico escalado a ${chosen.agent.role.toLowerCase()}`,
    };
  }

  private isSupervisor(role: UserRole): boolean {
    return role === UserRole.SUPERVISOR || role === UserRole.ADMIN;
  }
}

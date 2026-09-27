import { Injectable } from '@nestjs/common';
import { PrioritizedStrategy } from '@ticketera/patterns';
import {
  AgentWorkload,
  AssignmentContext,
  AssignmentResult,
  AssignmentStrategy,
} from './assignment.types';

/**
 * Reparto por carga: gana quien tenga menos tickets abiertos, desempatando por
 * menos tickets vencidos. Es el fallback general — siempre aplica.
 */
@Injectable()
export class LeastLoadedAssignmentStrategy
  implements AssignmentStrategy, PrioritizedStrategy<AssignmentContext, AssignmentResult | null>
{
  readonly name = 'least-loaded';
  readonly priority = 10;

  supports(context: AssignmentContext): boolean {
    return context.candidates.length > 0;
  }

  execute(context: AssignmentContext): AssignmentResult | null {
    const available = context.candidates
      .filter((c) => !this.isAtCapacity(c))
      .sort((a, b) => a.openTickets - b.openTickets || a.overdueTickets - b.overdueTickets);

    // Si todos están al límite, igual hay que asignar: elegimos al menos
    // cargado en absoluto antes que dejar el ticket sin dueño.
    const chosen =
      available[0] ?? [...context.candidates].sort((a, b) => a.openTickets - b.openTickets)[0];

    if (!chosen) return null;

    return {
      assignee: chosen.agent,
      rationale: `Agente con menor carga (${chosen.openTickets} abiertos, ${chosen.overdueTickets} vencidos)`,
    };
  }

  private isAtCapacity(candidate: AgentWorkload): boolean {
    const max = candidate.agent.maxConcurrentTickets;
    return max !== null && candidate.openTickets >= max;
  }
}

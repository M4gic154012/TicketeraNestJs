import { Injectable } from '@nestjs/common';
import { PrioritizedStrategy } from '@ticketera/patterns';
import {
  AgentWorkload,
  AssignmentContext,
  AssignmentResult,
  AssignmentStrategy,
} from './assignment.types';

/**
 * Asigna al especialista de la categoría con menos carga.
 *
 * Es la estrategia preferida: un ticket de red resuelto por quien sabe de red
 * cierra más rápido que uno resuelto por el agente más libre.
 */
@Injectable()
export class SkillBasedAssignmentStrategy
  implements AssignmentStrategy, PrioritizedStrategy<AssignmentContext, AssignmentResult | null>
{
  readonly name = 'skill-based';
  readonly priority = 30;

  supports(context: AssignmentContext): boolean {
    return context.candidates.some((c) => c.agent.hasSkill(context.category));
  }

  execute(context: AssignmentContext): AssignmentResult | null {
    const specialists = context.candidates
      .filter((c) => c.agent.hasSkill(context.category))
      .filter((c) => !this.isAtCapacity(c))
      .sort((a, b) => a.openTickets - b.openTickets);

    const chosen = specialists[0];
    if (!chosen) return null;

    return {
      assignee: chosen.agent,
      rationale: `Especialista en ${context.category} con ${chosen.openTickets} tickets abiertos`,
    };
  }

  private isAtCapacity(candidate: AgentWorkload): boolean {
    const max = candidate.agent.maxConcurrentTickets;
    return max !== null && candidate.openTickets >= max;
  }
}

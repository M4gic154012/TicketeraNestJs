import { Inject, Injectable } from '@nestjs/common';
import { BusinessRuleViolationError } from '@ticketera/common';
import { StrategyResolver } from '@ticketera/patterns';
import {
  ASSIGNMENT_STRATEGIES,
  AssignmentContext,
  AssignmentResult,
  AssignmentStrategy,
} from './assignment.types';

/**
 * Elige la estrategia de asignación aplicable de mayor prioridad y, si esa
 * estrategia no encuentra a nadie, degrada a la siguiente en vez de fallar.
 *
 * Agregar una estrategia nueva (por turno rotativo, por zona horaria) es sumar
 * un provider a ASSIGNMENT_STRATEGIES: ni el resolver ni el caso de uso cambian.
 */
@Injectable()
export class AssignmentStrategyResolver extends StrategyResolver<
  AssignmentContext,
  AssignmentResult | null
> {
  constructor(@Inject(ASSIGNMENT_STRATEGIES) strategies: AssignmentStrategy[]) {
    super(strategies);
  }

  protected get fallbackStrategyName(): string {
    return 'least-loaded';
  }

  /**
   * @returns el resultado y el nombre de la estrategia que lo produjo, para
   *   poder auditar por qué el ticket cayó en ese agente.
   */
  async assign(
    context: AssignmentContext,
  ): Promise<{ result: AssignmentResult; strategyName: string }> {
    if (context.candidates.length === 0) {
      throw new BusinessRuleViolationError('No hay agentes activos disponibles para asignar', {
        ticketId: context.ticket.id,
      });
    }

    const ordered = this.strategies
      .filter((s) => s.supports(context))
      .sort((a, b) => this.priorityOf(b) - this.priorityOf(a));

    for (const strategy of [...ordered, ...this.fallbackChain(ordered)]) {
      const result = await strategy.execute(context);
      if (result) {
        this.logger.log(
          `Ticket ${context.ticket.code} -> ${result.assignee.email} por '${strategy.name}'`,
        );
        return { result, strategyName: strategy.name };
      }
      this.logger.debug(`'${strategy.name}' no encontró candidato, probando la siguiente`);
    }

    throw new BusinessRuleViolationError('Ninguna estrategia pudo asignar el ticket', {
      ticketId: context.ticket.id,
      candidates: context.candidates.length,
    });
  }

  private fallbackChain(alreadyTried: AssignmentStrategy[]): AssignmentStrategy[] {
    const tried = new Set(alreadyTried.map((s) => s.name));
    const fallback = this.strategies.find(
      (s) => s.name === this.fallbackStrategyName && !tried.has(s.name),
    );
    return fallback ? [fallback] : [];
  }
}

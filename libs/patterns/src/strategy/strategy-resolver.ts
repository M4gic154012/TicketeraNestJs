import { Logger } from '@nestjs/common';
import { PrioritizedStrategy, Strategy } from './strategy.interface';

/**
 * Selecciona la estrategia aplicable de mayor prioridad. Las estrategias se
 * inyectan como colección (multi-provider), así que registrar una nueva es
 * agregar un provider — no editar el resolver.
 */
export abstract class StrategyResolver<TContext, TResult> {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly strategies: Strategy<TContext, TResult>[]) {}

  /** Nombre de la estrategia usada cuando ninguna declara soporte. */
  protected abstract get fallbackStrategyName(): string;

  resolve(context: TContext): Strategy<TContext, TResult> {
    const candidates = this.strategies
      .filter((s) => s.supports(context))
      .sort((a, b) => this.priorityOf(b) - this.priorityOf(a));

    if (candidates.length > 0) return candidates[0];

    const fallback = this.strategies.find((s) => s.name === this.fallbackStrategyName);
    if (!fallback) {
      throw new Error(
        `No hay estrategia aplicable y falta el fallback '${this.fallbackStrategyName}' en ${this.constructor.name}`,
      );
    }

    this.logger.debug(`Sin estrategia específica, usando fallback '${fallback.name}'`);
    return fallback;
  }

  async run(context: TContext): Promise<TResult> {
    const strategy = this.resolve(context);
    this.logger.debug(`Ejecutando estrategia '${strategy.name}'`);
    return strategy.execute(context);
  }

  protected priorityOf(strategy: Strategy<TContext, TResult>): number {
    return (strategy as PrioritizedStrategy<TContext, TResult>).priority ?? 0;
  }
}

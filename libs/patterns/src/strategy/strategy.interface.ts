/**
 * Patrón Strategy.
 *
 * Una familia de algoritmos intercambiables detrás de una misma interfaz, para
 * que el llamador elija comportamiento sin ramificar con if/switch. Cada
 * estrategia declara `supports` para que el resolver la seleccione por
 * contexto en lugar de que el llamador la nombre a mano.
 */
export interface Strategy<TContext, TResult> {
  /** Identificador estable de la estrategia. Se usa en config y en logs. */
  readonly name: string;

  /** ¿Esta estrategia aplica al contexto dado? */
  supports(context: TContext): boolean;

  execute(context: TContext): Promise<TResult> | TResult;
}

/**
 * Prioridad de evaluación: a mayor número, se consulta antes. Permite tener
 * estrategias específicas que ganan sobre una genérica de fallback.
 */
export interface PrioritizedStrategy<TContext, TResult>
  extends Strategy<TContext, TResult> {
  readonly priority: number;
}

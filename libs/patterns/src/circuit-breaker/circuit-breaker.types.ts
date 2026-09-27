export enum CircuitState {
  /** Todo pasa. Se cuentan fallos en la ventana deslizante. */
  CLOSED = 'CLOSED',
  /** Se rechaza sin llamar al dependiente. Protege al caído y al llamador. */
  OPEN = 'OPEN',
  /** Se deja pasar un número acotado de sondas para ver si ya recuperó. */
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  /** Nombre del recurso protegido. Aparece en métricas y logs. */
  name: string;
  /** Porcentaje de fallos (0-100) que abre el circuito. */
  failureThresholdPercentage: number;
  /** Mínimo de llamadas en la ventana antes de poder abrir. */
  minimumThroughput: number;
  /** Tamaño de la ventana deslizante, en cantidad de llamadas. */
  rollingWindowSize: number;
  /** ms que el circuito permanece OPEN antes de pasar a HALF_OPEN. */
  resetTimeoutMs: number;
  /** Llamadas de sondeo permitidas en HALF_OPEN. */
  halfOpenMaxAttempts: number;
  /** Timeout por llamada. Un dependiente lento cuenta como fallo. */
  timeoutMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_OPTIONS: Omit<CircuitBreakerOptions, 'name'> = {
  failureThresholdPercentage: 50,
  minimumThroughput: 10,
  rollingWindowSize: 20,
  resetTimeoutMs: 15_000,
  halfOpenMaxAttempts: 3,
  timeoutMs: 3_000,
};

export interface CircuitBreakerSnapshot {
  name: string;
  state: CircuitState;
  failureRate: number;
  callsInWindow: number;
  openedAt: Date | null;
  lastError: string | null;
}

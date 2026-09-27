import { Logger } from '@nestjs/common';
import { CircuitOpenError } from './circuit-open.error';
import {
  CircuitBreakerOptions,
  CircuitBreakerSnapshot,
  CircuitState,
} from './circuit-breaker.types';

type Outcome = 'success' | 'failure';

/**
 * Patrón Circuit Breaker.
 *
 * Envuelve llamadas a un dependiente remoto y deja de intentarlas cuando la
 * tasa de fallos en la ventana deslizante supera el umbral. Sin esto, un
 * microservicio caído hace que el llamador acumule llamadas colgadas hasta
 * quedarse sin recursos (fallo en cascada).
 *
 * Transiciones:
 *   CLOSED --(tasa de fallos > umbral)--> OPEN
 *   OPEN --(pasa resetTimeoutMs)--> HALF_OPEN
 *   HALF_OPEN --(sonda OK)--> CLOSED | --(sonda falla)--> OPEN
 */
export class CircuitBreaker {
  private readonly logger: Logger;
  private state: CircuitState = CircuitState.CLOSED;
  private readonly window: Outcome[] = [];
  private openedAt: number | null = null;
  private halfOpenInFlight = 0;
  private halfOpenSuccesses = 0;
  private lastError: string | null = null;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.logger = new Logger(`CircuitBreaker:${options.name}`);
  }

  /**
   * Ejecuta `operation` bajo protección del circuito.
   *
   * @param fallback Valor/función de degradación elegante. Si se provee, se usa
   *   en lugar de propagar el error cuando el circuito está abierto o la
   *   llamada falla. Úsalo solo donde una respuesta parcial sea aceptable.
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback?: (error: Error) => Promise<T> | T,
  ): Promise<T> {
    if (!this.allowRequest()) {
      const error = new CircuitOpenError(this.options.name, this.remainingResetMs());
      if (fallback) return fallback(error);
      throw error;
    }

    const isProbe = this.state === CircuitState.HALF_OPEN;
    if (isProbe) this.halfOpenInFlight++;

    try {
      const result = await this.withTimeout(operation());
      this.onSuccess();
      return result;
    } catch (error) {
      if (!CircuitBreaker.isInfrastructureFailure(error)) {
        // Un rechazo de negocio (credenciales inválidas, transición no
        // permitida) significa que el dependiente está SANO: respondió y
        // respondió bien. Contarlo abriría el circuito por culpa de los
        // usuarios, cortando el servicio para todos.
        throw error;
      }

      this.onFailure(error as Error);
      if (fallback) return fallback(error as Error);
      throw error;
    } finally {
      if (isProbe) this.halfOpenInFlight--;
    }
  }

  /**
   * Distingue "el dependiente está caído" de "el dependiente dijo que no".
   *
   * Solo lo primero es señal de salud. Los errores con status 4xx son respuestas
   * legítimas del servicio y no deben contar contra el umbral.
   */
  static isInfrastructureFailure(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return true;

    // Un 503 que dice "MI dependiente está caído" no es un fallo del servicio que
    // lo devolvió: respondió, y respondió con información correcta. Contarlo hacía
    // que una caída de users-service abriera también el circuito de tickets-service,
    // que estaba sano — y eso corta además las operaciones de tickets que no
    // necesitan users (buscar, comentar, cambiar estado). Amplifica la caída en vez
    // de contenerla.
    const code = (error as { code?: string }).code;
    if (code === 'UPSTREAM_UNAVAILABLE') return false;

    const status = (error as { httpStatus?: number; status?: number }).httpStatus ??
      (error as { status?: number }).status;

    if (typeof status === 'number' && status >= 400 && status < 500) {
      // 408 (timeout) y 429 (saturación) sí son señales de un dependiente en
      // problemas, aunque estén en el rango 4xx.
      return status === 408 || status === 429;
    }

    return true;
  }

  snapshot(): CircuitBreakerSnapshot {
    return {
      name: this.options.name,
      state: this.state,
      failureRate: this.failureRate(),
      callsInWindow: this.window.length,
      openedAt: this.openedAt ? new Date(this.openedAt) : null,
      lastError: this.lastError,
    };
  }

  private allowRequest(): boolean {
    if (this.state === CircuitState.CLOSED) return true;

    if (this.state === CircuitState.OPEN) {
      if (this.remainingResetMs() <= 0) {
        this.transitionTo(CircuitState.HALF_OPEN);
        return true;
      }
      return false;
    }

    // HALF_OPEN: solo se admite un número acotado de sondas simultáneas.
    return this.halfOpenInFlight < this.options.halfOpenMaxAttempts;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Timeout de ${this.options.timeoutMs}ms al llamar a '${this.options.name}'`,
                ),
              ),
            this.options.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private onSuccess(): void {
    this.record('success');

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.options.halfOpenMaxAttempts) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }
  }

  private onFailure(error: Error): void {
    this.lastError = error.message;
    this.record('failure');

    if (this.state === CircuitState.HALF_OPEN) {
      // Una sola sonda fallida basta: el dependiente sigue enfermo.
      this.transitionTo(CircuitState.OPEN);
      return;
    }

    if (
      this.state === CircuitState.CLOSED &&
      this.window.length >= this.options.minimumThroughput &&
      this.failureRate() >= this.options.failureThresholdPercentage
    ) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private record(outcome: Outcome): void {
    this.window.push(outcome);
    if (this.window.length > this.options.rollingWindowSize) this.window.shift();
  }

  private failureRate(): number {
    if (this.window.length === 0) return 0;
    const failures = this.window.filter((o) => o === 'failure').length;
    return (failures / this.window.length) * 100;
  }

  private remainingResetMs(): number {
    if (this.openedAt === null) return 0;
    return Math.max(0, this.options.resetTimeoutMs - (Date.now() - this.openedAt));
  }

  private transitionTo(next: CircuitState): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;

    if (next === CircuitState.OPEN) {
      this.openedAt = Date.now();
    } else {
      this.openedAt = null;
    }

    if (next === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses = 0;
    }

    if (next === CircuitState.CLOSED) {
      this.window.length = 0;
      this.halfOpenSuccesses = 0;
      this.lastError = null;
    }

    const errorSuffix = this.lastError ? ` (último error: ${this.lastError})` : '';
    const message = `${previous} -> ${next}${errorSuffix}`;
    if (next === CircuitState.CLOSED) {
      this.logger.log(message);
    } else {
      this.logger.warn(message);
    }
  }
}

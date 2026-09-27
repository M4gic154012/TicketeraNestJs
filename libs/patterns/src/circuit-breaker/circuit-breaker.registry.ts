import { Injectable } from '@nestjs/common';
import { CircuitBreaker } from './circuit-breaker';
import {
  CircuitBreakerOptions,
  CircuitBreakerSnapshot,
  DEFAULT_CIRCUIT_BREAKER_OPTIONS,
} from './circuit-breaker.types';

/**
 * Un breaker por recurso protegido, compartido por todo el proceso: el estado
 * debe ser común a todas las peticiones, si no cada request tendría su propia
 * ventana y el circuito nunca abriría.
 */
@Injectable()
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly registeredWith = new Map<string, Partial<CircuitBreakerOptions>>();

  get(name: string, overrides: Partial<CircuitBreakerOptions> = {}): CircuitBreaker {
    const existing = this.breakers.get(name);
    if (existing) {
      this.assertConsistentOverrides(name, overrides);
      return existing;
    }

    const breaker = new CircuitBreaker({
      ...DEFAULT_CIRCUIT_BREAKER_OPTIONS,
      ...overrides,
      name,
    });
    this.breakers.set(name, breaker);
    this.registeredWith.set(name, overrides);
    return breaker;
  }

  /**
   * El breaker es único por recurso y por proceso (ver comentario de la clase):
   * si dos llamantes piden el mismo `name` con `overrides` distintos, gana en
   * silencio el que se ejecutó primero y el timeout real queda librado al orden
   * de arranque. Eso ya pasó: `AuthService.login` y `UpstreamClient` piden
   * `'users-service'` con timeouts distintos en el mismo proceso. Mejor fallar
   * fuerte en el momento del conflicto que tener un timeout que cambia según
   * quién llegó primero.
   */
  private assertConsistentOverrides(name: string, overrides: Partial<CircuitBreakerOptions>): void {
    const registered = this.registeredWith.get(name) ?? {};
    const keys = new Set([
      ...Object.keys(registered),
      ...Object.keys(overrides),
    ]) as Set<keyof CircuitBreakerOptions>;

    for (const key of keys) {
      if (registered[key] !== overrides[key]) {
        throw new Error(
          `Circuit breaker '${name}' ya está registrado con otra configuración ` +
            `(${JSON.stringify(registered)} vs ${JSON.stringify(overrides)}). ` +
            `Es un breaker por recurso y por proceso: unificá el override en todos los llamantes.`,
        );
      }
    }
  }

  /** Estado de todos los circuitos, para el endpoint de health/diagnóstico. */
  snapshots(): CircuitBreakerSnapshot[] {
    return [...this.breakers.values()].map((b) => b.snapshot());
  }
}

import { CircuitBreaker } from './circuit-breaker';
import { CircuitOpenError } from './circuit-open.error';
import { CircuitState, DEFAULT_CIRCUIT_BREAKER_OPTIONS } from './circuit-breaker.types';

describe('CircuitBreaker', () => {
  const build = (overrides: Partial<typeof DEFAULT_CIRCUIT_BREAKER_OPTIONS> = {}) =>
    new CircuitBreaker({
      ...DEFAULT_CIRCUIT_BREAKER_OPTIONS,
      name: 'prueba',
      minimumThroughput: 4,
      rollingWindowSize: 10,
      failureThresholdPercentage: 50,
      resetTimeoutMs: 50,
      halfOpenMaxAttempts: 2,
      timeoutMs: 100,
      ...overrides,
    });

  const boom = () => Promise.reject(new Error('caído'));
  const ok = () => Promise.resolve('bien');

  it('permanece cerrado mientras no se alcanza el mínimo de llamadas', async () => {
    const breaker = build();

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(boom)).rejects.toThrow('caído');
    }

    expect(breaker.snapshot().state).toBe(CircuitState.CLOSED);
  });

  it('abre cuando la tasa de fallos supera el umbral', async () => {
    const breaker = build();

    for (let i = 0; i < 4; i++) {
      await expect(breaker.execute(boom)).rejects.toThrow();
    }

    expect(breaker.snapshot().state).toBe(CircuitState.OPEN);
  });

  it('rechaza sin llamar al dependiente mientras está abierto', async () => {
    const breaker = build();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(boom)).rejects.toThrow();

    const operation = jest.fn(ok);
    await expect(breaker.execute(operation)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('usa el fallback en lugar de propagar cuando está abierto', async () => {
    const breaker = build();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(boom)).rejects.toThrow();

    await expect(breaker.execute(ok, async () => 'degradado')).resolves.toBe('degradado');
  });

  it('cierra tras acumular sondas exitosas en HALF_OPEN', async () => {
    const breaker = build();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(boom)).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 60));

    await expect(breaker.execute(ok)).resolves.toBe('bien');
    await expect(breaker.execute(ok)).resolves.toBe('bien');

    expect(breaker.snapshot().state).toBe(CircuitState.CLOSED);
  });

  it('vuelve a abrir si la primera sonda falla', async () => {
    const breaker = build();
    for (let i = 0; i < 4; i++) await expect(breaker.execute(boom)).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(breaker.execute(boom)).rejects.toThrow();

    expect(breaker.snapshot().state).toBe(CircuitState.OPEN);
  });

  it('cuenta como fallo una operación que excede el timeout', async () => {
    const breaker = build({ timeoutMs: 20, minimumThroughput: 2 });
    const lenta = () => new Promise((resolve) => setTimeout(resolve, 200));

    await expect(breaker.execute(lenta)).rejects.toThrow(/Timeout/);
    await expect(breaker.execute(lenta)).rejects.toThrow(/Timeout/);

    expect(breaker.snapshot().state).toBe(CircuitState.OPEN);
  });

  describe('isInfrastructureFailure', () => {
    it('no cuenta los rechazos de negocio 4xx', () => {
      expect(CircuitBreaker.isInfrastructureFailure({ httpStatus: 401 })).toBe(false);
      expect(CircuitBreaker.isInfrastructureFailure({ httpStatus: 409 })).toBe(false);
    });

    it('sí cuenta 408 y 429, que indican un dependiente en problemas', () => {
      expect(CircuitBreaker.isInfrastructureFailure({ httpStatus: 408 })).toBe(true);
      expect(CircuitBreaker.isInfrastructureFailure({ httpStatus: 429 })).toBe(true);
    });

    /**
     * Regresión del fallo en cascada. Un servicio intermedio que devuelve
     * UPSTREAM_UNAVAILABLE está sano: el caído es su dependiente. Contarlo abría el
     * circuito del intermedio y cortaba también sus operaciones que no dependían
     * del servicio caído.
     */
    it('no cuenta un 503 que reporta la caída de un tercero', () => {
      expect(
        CircuitBreaker.isInfrastructureFailure({
          code: 'UPSTREAM_UNAVAILABLE',
          httpStatus: 503,
          message: 'Un servicio interno no está disponible temporalmente',
        }),
      ).toBe(false);
    });

    it('sí cuenta un 503 propio, sin código de upstream', () => {
      expect(CircuitBreaker.isInfrastructureFailure({ httpStatus: 503 })).toBe(true);
    });

    it('cuenta los 5xx y los errores sin status', () => {
      expect(CircuitBreaker.isInfrastructureFailure({ httpStatus: 500 })).toBe(true);
      expect(CircuitBreaker.isInfrastructureFailure(new Error('ECONNREFUSED'))).toBe(true);
    });
  });

  it('un rechazo de negocio no abre el circuito', async () => {
    const breaker = build({ minimumThroughput: 2 });
    const rechazo = () => Promise.reject({ httpStatus: 401, message: 'credenciales' });

    for (let i = 0; i < 6; i++) {
      await expect(breaker.execute(rechazo)).rejects.toMatchObject({ httpStatus: 401 });
    }

    expect(breaker.snapshot().state).toBe(CircuitState.CLOSED);
    expect(breaker.snapshot().callsInWindow).toBe(0);
  });
});

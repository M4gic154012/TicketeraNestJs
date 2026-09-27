import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Se lanza cuando el circuito está OPEN y la llamada se corta sin salir a red.
 * Extiende ServiceUnavailableException para que el filtro HTTP la traduzca a
 * 503 sin mapeos extra, y expone `circuit` para que el llamador decida si
 * aplica un fallback o propaga el error.
 */
export class CircuitOpenError extends ServiceUnavailableException {
  constructor(public readonly circuit: string, public readonly retryAfterMs: number) {
    super({
      message: `El servicio '${circuit}' no está disponible temporalmente`,
      circuit,
      retryAfterMs,
    });
  }
}

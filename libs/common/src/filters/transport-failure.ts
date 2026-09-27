/**
 * Reconoce los fallos de transporte del ClientProxy de Nest.
 *
 * Estos errores no llegan como error serializado del servicio destino porque el
 * mensaje nunca alcanzó a nadie: el proceso está caído, el puerto rechaza la
 * conexión o el handler no existe. Traducirlos a 500 le dice al cliente "hay un
 * bug"; traducirlos a 503 le dice "reintentá", que es la verdad.
 *
 * Vive en un módulo propio porque lo necesitan tanto el filtro HTTP del gateway
 * como el filtro RPC de cada microservicio.
 */
/**
 * Códigos de error de red que significan "el dependiente no está".
 *
 * `ENOTFOUND` es el que ocurre de verdad en la topología desplegada: un contenedor
 * detenido no rechaza la conexión, directamente **no resuelve por DNS**. Faltaba, y
 * por eso una caída real devolvía 500 en lugar de 503 pese a la lista de tres
 * códigos que sí estaban.
 *
 * Peor todavía, el 500 espurio contaba como fallo de infraestructura: una caída de
 * users-service empujaba hacia OPEN el circuito de tickets-service, que estaba sano.
 */
const TRANSPORT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
]);

export function isTransportFailure(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) return false;

  const code = (exception as { code?: string }).code;
  if (code && TRANSPORT_ERROR_CODES.has(code)) return true;

  // Un timeout ES un fallo de transporte: el dependiente no respondió en tiempo.
  // Con un contenedor detenido, el ClientProxy sigue reintentando la resolución DNS
  // (EAI_AGAIN) y el `timeout()` de RxJS dispara primero, así que el error que llega
  // al filtro es un TimeoutError y no el código de red — por eso crear un ticket
  // seguía devolviendo 500 aunque el login ya devolviera 503.
  const name = (exception as { name?: string }).name;
  if (name === 'TimeoutError' || name === 'EmptyError') return true;

  const message = (exception as { message?: string }).message ?? '';

  return (
    message.includes('There is no matching message handler') ||
    message.includes('Connection closed') ||
    message.includes('Empty response') ||
    message.includes('Timeout has occurred') ||
    // El timeout propio del circuit breaker.
    /^Timeout de \d+ms al llamar a/.test(message) ||
    // RxJS firstValueFrom sobre un observable que completa sin emitir.
    message.includes('no elements in sequence') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('getaddrinfo') ||
    message.includes('no está disponible temporalmente')
  );
}

export const UPSTREAM_UNAVAILABLE_ERROR = {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'Un servicio interno no está disponible temporalmente',
  httpStatus: 503,
} as const;

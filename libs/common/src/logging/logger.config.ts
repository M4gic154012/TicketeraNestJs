import { Params as PinoParams } from 'nestjs-pino';
import { CORRELATION_ID_HEADER } from '../interceptors/correlation-id.middleware';

/**
 * Logging estructurado. En producción sale JSON a stdout (lo recoge el
 * agregador); en desarrollo se formatea legible.
 *
 * `redact` es defensivo a propósito: password, tokens y cookies no deben
 * terminar en un log, ni por accidente al loguear un body completo.
 */
export function buildLoggerConfig(serviceName: string): PinoParams {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      name: serviceName,
      level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
      transport: isProduction
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          'res.headers["set-cookie"]',
          '*.passwordHash',
          '*.refreshToken',
        ],
        censor: '[REDACTED]',
      },
      // `name` ya emite el servicio en cada línea: repetirlo en customProps
      // generaba la clave "service" duplicada en el JSON, y un parser estricto
      // descarta una de las dos.
      customProps: (req) => ({
        correlationId: req.headers[CORRELATION_ID_HEADER],
      }),
      autoLogging: {
        // Comparación por inclusión, no por igualdad: con el prefijo global la URL
        // real es `/api/v1/health/live`, así que el filtro exacto nunca aplicaba y
        // cada healthcheck logueaba el request completo con todos los headers de
        // helmet — del orden de 14 MB/día de puro ruido por instancia.
        ignore: (req) => (req.url ?? '').includes('/health'),
      },
    },
  };
}

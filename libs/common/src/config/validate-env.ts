import { envValidationSchema } from './env.validation';

/**
 * Prefijos de las variables propias del proyecto. Todo lo que empiece con uno de
 * estos y no esté declarado en el esquema es, casi con seguridad, un error de
 * tipeo.
 */
const OWNED_PREFIXES = [
  'DB_',
  'JWT_',
  'RPC_',
  'CB_',
  'SLA_',
  'THROTTLE_',
  'CORS_',
  'BCRYPT_',
  'GATEWAY_',
  'BFF_',
  'USERS_',
  'TICKETS_',
  'NOTIFICATIONS_',
  'MICROSERVICE_',
  'ENABLE_',
  'SCHEDULER_',
  'BACKUP_',
  'NOTIFICATION_',
  'MAIL_',
  'EMAIL_',
];

/**
 * Variables que la propia plataforma de CI define y que por pura coincidencia
 * comparten un prefijo con las nuestras (`ENABLE_` de `ENABLE_SWAGGER`, acá).
 * No son del proyecto y no hay forma de que el `.env` las declare, así que se
 * excluyen por nombre en vez de sumarlas al esquema — sumarlas ahí las haría
 * pasar por una variable que el proyecto entiende y usa, que no es el caso.
 */
const EXTERNAL_ENV_ALLOWLIST = new Set([
  // Runners hospedados de GitHub Actions: variable interna de diagnóstico del
  // propio runner. Ver el job `test` en .github/workflows/ci.yml.
  'ENABLE_RUNNER_TRACING',
]);

/**
 * Valida el entorno.
 *
 * `allowUnknown` queda en `true` y NO es negociable: `@nestjs/config` valida
 * `process.env` completo, así que ponerlo en `false` rechaza `PATH`, `HOME` y
 * todas las `npm_*` — el proceso no arranca (comprobado).
 *
 * Lo que sí hace falta es atajar el error real que `allowUnknown` deja pasar:
 * `CORS_ORIGIN` en lugar de `CORS_ORIGINS`, o `JWT_SECRETE`, arrancaban en
 * silencio aplicando el valor por omisión. Por eso, después de validar el
 * esquema, se rechaza toda variable con un prefijo del proyecto que el esquema no
 * declare: acota la verificación a lo nuestro sin pelear con el entorno del sistema.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const { error, value } = envValidationSchema.validate(config, {
    abortEarly: false,
    allowUnknown: true,
  });

  if (error) {
    throw new Error(`Configuración inválida:\n  - ${error.details.map((d) => d.message).join('\n  - ')}`);
  }

  const declared = new Set(Object.keys(envValidationSchema.describe().keys));
  const suspicious = Object.keys(config).filter(
    (key) =>
      !declared.has(key) &&
      !EXTERNAL_ENV_ALLOWLIST.has(key) &&
      OWNED_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );

  if (suspicious.length > 0) {
    throw new Error(
      `Variables de entorno no reconocidas (¿error de tipeo?): ${suspicious.join(', ')}.\n` +
        'Si son legítimas, declaralas en libs/common/src/config/env.validation.ts.',
    );
  }

  return value as Record<string, unknown>;
}

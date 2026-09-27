import * as Joi from 'joi';

/**
 * Esquema de entorno, compartido por los cinco procesos.
 *
 * Regla de diseño: el esquema valida el FORMATO de cada variable (largo mínimo,
 * que no sea un placeholder, rangos), pero **no exige presencia** de lo que solo
 * usan algunos servicios. Cada proceso reclama lo suyo con `getOrThrow` donde lo
 * consume, así que sigue habiendo fail-fast — y con un mensaje que dice qué
 * servicio necesitaba qué.
 *
 * Si el esquema exigiera `JWT_SECRET` a todos, el diseño de secretos se rompería
 * al revés: habría que darle a los microservicios el secreto de firma que por
 * topología no deben conocer, solo para que arranquen.
 *
 * Lo único requerido para todos es `RPC_SHARED_SECRET`: los cinco hablan por el
 * transporte interno y ninguno debe poder hacerlo sin autenticar.
 */
/**
 * Valores publicados en `.env.example`. Cumplen el mínimo de largo, así que sin
 * invalidarlos explícitamente el sistema arrancaba contento con un secreto que
 * está escrito en el repositorio.
 */
const PLACEHOLDER_SECRETS = [
  'reemplazar_por_un_secreto_de_al_menos_32_caracteres',
  'reemplazar_por_otro_secreto_de_al_menos_32_caracteres',
];

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),

  // Puertos
  GATEWAY_HTTP_PORT: Joi.number().port().default(3000),
  BFF_WEB_TCP_PORT: Joi.number().port().default(4001),
  USERS_TCP_PORT: Joi.number().port().default(4101),
  TICKETS_TCP_PORT: Joi.number().port().default(4102),
  NOTIFICATIONS_TCP_PORT: Joi.number().port().default(4103),
  EMAIL_INGESTION_TCP_PORT: Joi.number().port().default(4104),

  // Hosts de los microservicios (nombres de servicio en Docker)
  BFF_WEB_HOST: Joi.string().default('127.0.0.1'),
  USERS_HOST: Joi.string().default('127.0.0.1'),
  TICKETS_HOST: Joi.string().default('127.0.0.1'),
  NOTIFICATIONS_HOST: Joi.string().default('127.0.0.1'),
  EMAIL_INGESTION_HOST: Joi.string().default('127.0.0.1'),

  // PostgreSQL
  DB_HOST: Joi.string().default('127.0.0.1'),
  DB_PORT: Joi.number().port().default(5432),
  // Solo los tres servicios que persisten. Los reclama buildTypeOrmOptions con
  // getOrThrow; el gateway y el BFF no los reciben porque no tocan la base.
  DB_USER: Joi.string().optional(),
  DB_PASSWORD: Joi.string().optional(),
  DB_NAME: Joi.string().optional(),
  /**
   * Cifrado de la conexión a Postgres.
   *
   * No se fuerza a `true` en producción a propósito: en el despliegue de un solo
   * host con Docker Compose, la base solo es alcanzable desde la red interna y no
   * tiene certificados, así que exigirlo impediría arrancar sin agregar seguridad
   * real. Ponelo en `true` — y es obligatorio — en cuanto la base deje de estar en
   * la misma máquina: un Postgres administrado o cualquier salto por red física.
   */
  DB_SSL: Joi.boolean().default(false),
  DB_POOL_MAX: Joi.number().min(1).default(10),
  DB_LOGGING: Joi.boolean().default(false),

  // Auth
  // Solo el gateway. Lo reclama con getOrThrow en JwtModule y en JwtStrategy.
  JWT_SECRET: Joi.string()
    .min(32)
    .invalid(...PLACEHOLDER_SECRETS)
    .optional()
    .messages({
      'string.min': 'JWT_SECRET debe tener al menos 32 caracteres',
      'any.invalid': 'JWT_SECRET sigue siendo el valor de ejemplo; generá uno propio',
    }),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_ISSUER: Joi.string().default('ticketera'),
  JWT_AUDIENCE: Joi.string().default('ticketera-api'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  BCRYPT_ROUNDS: Joi.number().min(10).max(15).default(12),

  /**
   * Secreto compartido entre gateway, BFF y microservicios. Distinto del de JWT:
   * si se filtrara uno, no debe comprometer el otro.
   */
  RPC_SHARED_SECRET: Joi.string()
    .min(32)
    .invalid(...PLACEHOLDER_SECRETS)
    .required()
    .messages({
      'string.min': 'RPC_SHARED_SECRET debe tener al menos 32 caracteres',
      'any.invalid': 'RPC_SHARED_SECRET sigue siendo el valor de ejemplo; generá uno propio',
    }),

  /**
   * Interfaz donde escuchan los microservicios. Por omisión loopback: exponerlos
   * en 0.0.0.0 los deja alcanzables desde toda la red. En Docker Compose se pone
   * 0.0.0.0 porque el aislamiento lo da la red del compose.
   */
  MICROSERVICE_BIND_HOST: Joi.string().default('127.0.0.1'),

  /**
   * Publica Swagger en /api/docs. Separado de NODE_ENV para no depender de él.
   *
   * En producción NO está prohibido, pero sí exige credenciales: la documentación
   * completa de la API es un mapa de la superficie de ataque, y dejarla abierta en un
   * ambiente accesible es regalarlo. Con `SWAGGER_USER`/`SWAGGER_PASSWORD` se puede
   * consultar cuando hace falta sin que quede público.
   */
  ENABLE_SWAGGER: Joi.boolean().default(false),

  /**
   * Credenciales de la documentación. Obligatorias si Swagger está habilitado en
   * producción — sin ellas el arranque falla, en lugar de publicar /api/docs abierto
   * porque alguien se olvidó de completarlas.
   */
  SWAGGER_USER: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.when('ENABLE_SWAGGER', { is: true, then: Joi.string().min(3).required() }),
    }),
  SWAGGER_PASSWORD: Joi.string()
    .allow('')
    .optional()
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.when('ENABLE_SWAGGER', { is: true, then: Joi.string().min(12).required() }),
    })
    .messages({
      'string.min': 'SWAGGER_PASSWORD debe tener al menos 12 caracteres',
      'any.required':
        'Con ENABLE_SWAGGER=true en producción hay que definir SWAGGER_USER y SWAGGER_PASSWORD',
    }),

  /** Solo una réplica de cada servicio debe ejecutar tareas programadas. */
  SCHEDULER_ENABLED: Joi.boolean().default(true),

  // Borde
  // Solo el gateway (único proceso con HTTP). Sin default en producción: un
  // default silencioso acá rompe el frontend real sin decir por qué.
  CORS_ORIGINS: Joi.string().optional(),
  THROTTLE_TTL_MS: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(100),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),

  // Circuit breaker (aplicado a las llamadas salientes del gateway y del BFF)
  CB_TIMEOUT_MS: Joi.number().default(3000),
  CB_FAILURE_THRESHOLD_PCT: Joi.number().min(1).max(100).default(50),
  CB_RESET_TIMEOUT_MS: Joi.number().default(15000),

  /** Días que se conservan las notificaciones ya leídas. */
  NOTIFICATION_RETENTION_DAYS: Joi.number().min(1).default(90),

  // --- Ingesta de tickets por correo -------------------------------------
  /** Interruptor general de la ingesta. */
  MAIL_INGESTION_ENABLED: Joi.boolean().default(false),
  /**
   * Adaptador de buzón: 'simulado' lee archivos .eml de un directorio (permite probar
   * sin la cuenta creada), 'imap' se conecta al buzón real.
   */
  MAIL_ADAPTER: Joi.string().valid('simulado', 'imap').default('simulado'),
  /** Dirección del propio buzón. Se usa para cortar bucles de correo. */
  MAIL_ADDRESS: Joi.string().email().default('soporte@cmm.uchile.cl'),
  /** Dominios cuyos remitentes se aceptan, separados por coma. Vacío = cualquiera. */
  MAIL_ALLOWED_DOMAINS: Joi.string().default('uchile.cl'),
  MAIL_POLL_BATCH_SIZE: Joi.number().min(1).max(200).default(25),

  /** Directorio de los .eml para el adaptador simulado. */
  MAIL_SIMULATED_DIR: Joi.string().allow('').optional(),

  // IMAP. Para Google Workspace hace falta una contraseña de aplicación: la
  // contraseña normal de la cuenta no sirve para IMAP.
  // `.allow('')` a propósito: estas variables se declaran en el .env desde el día
  // uno pero quedan vacías hasta que la cuenta institucional exista. Rechazar el
  // string vacío obligaba a comentar las líneas, que es cómo se pierde la
  // documentación de qué hay que completar.
  MAIL_IMAP_HOST: Joi.string().allow('').optional(),
  MAIL_IMAP_PORT: Joi.number().port().default(993),
  MAIL_IMAP_USER: Joi.string().allow('').optional(),
  MAIL_IMAP_PASSWORD: Joi.string().allow('').optional(),
  MAIL_IMAP_MAILBOX: Joi.string().default('INBOX'),

  // Variables de operación: no las usa la aplicación, pero comparten el archivo
  // de entorno. Se declaran para poder correr con allowUnknown: false.
  TZ: Joi.string().optional(),
  BACKUP_DIR: Joi.string().optional(),
  BACKUP_RETENTION_DAYS: Joi.number().optional(),
  DB_CONTAINER: Joi.string().optional(),
  DB_MAX_CONNECTIONS: Joi.number().optional(),
  GIT_SHA: Joi.string().optional(),
  BUILD_DATE: Joi.string().optional(),
  APP_VERSION: Joi.string().optional(),
  APP_ENTRY: Joi.string().optional(),
  TICKETS_SCHEDULER_ENABLED: Joi.boolean().optional(),
  NOTIFICATIONS_SCHEDULER_ENABLED: Joi.boolean().optional(),
  SEED_PASSWORD: Joi.string().optional(),
  /** Certificado de la CA de Postgres. Su presencia activa la validación real. */
  DB_CA_CERT: Joi.string().optional(),

  // SLA por prioridad, en minutos
  SLA_CRITICAL_MINUTES: Joi.number().default(60),
  SLA_HIGH_MINUTES: Joi.number().default(240),
  SLA_MEDIUM_MINUTES: Joi.number().default(1440),
  SLA_LOW_MINUTES: Joi.number().default(4320),
});

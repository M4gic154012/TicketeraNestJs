import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'node:path';
import {
  DataSubjectRequest,
  Notification,
  ProcessedEmail,
  Ticket,
  TicketComment,
  TicketStatusHistory,
  User,
} from './entities';

/**
 * Opciones de TypeORM compartidas por todos los servicios que tocan la base.
 *
 * Se listan las entidades explícitamente en lugar de usar globs: con globs, un
 * build que no copia los .js rompe en runtime y el error es opaco.
 */
/**
 * TLS hacia Postgres.
 *
 * `rejectUnauthorized: false` cifra pero NO autentica al servidor: da una falsa
 * sensación de conexión verificada y no protege de un intermediario. Con
 * `DB_CA_CERT` presente se valida de verdad; sin él se acepta sin validar, que es
 * tolerable mientras la base viva en la red interna del compose y no lo es en
 * cuanto sea una base gestionada y remota.
 */
function buildSslOptions(config: ConfigService): false | Record<string, unknown> {
  if (!config.get<boolean>('DB_SSL')) return false;

  const ca = config.get<string>('DB_CA_CERT');
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

export function buildTypeOrmOptions(config: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.getOrThrow<string>('DB_HOST'),
    port: config.getOrThrow<number>('DB_PORT'),
    username: config.getOrThrow<string>('DB_USER'),
    password: config.getOrThrow<string>('DB_PASSWORD'),
    database: config.getOrThrow<string>('DB_NAME'),
    ssl: buildSslOptions(config),
    entities: [
      User,
      Ticket,
      TicketComment,
      TicketStatusHistory,
      Notification,
      ProcessedEmail,
      DataSubjectRequest,
    ],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    // synchronize SIEMPRE en false, en todos los entornos.
    //
    // No es solo por producción: el schema-builder de TypeORM no puede expresar
    // los índices GIN/trgm, los parciales ni los funcionales que este esquema usa,
    // así que su diff los ELIMINA. Con synchronize activo en desarrollo, el
    // esquema de dev deja de parecerse al de producción y cualquier medición de
    // plan de ejecución hecha ahí no vale nada.
    //
    // Por la misma razón no existe el script `migration:generate`: las migraciones
    // se escriben a mano en libs/database/src/migrations/.
    synchronize: false,
    migrationsRun: false,
    logging: config.get<boolean>('DB_LOGGING') ? ['query', 'error', 'warn'] : ['error', 'warn'],
    extra: {
      max: config.get<number>('DB_POOL_MAX') ?? 10,
      // Un pool sin timeouts es cómo un microservicio se queda esperando para
      // siempre por una conexión que nunca vuelve.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Coherente con el presupuesto del borde: el circuit breaker abandona a los
      // 3 s, así que una consulta de 15 s seguía ocupando una conexión (y su lock)
      // haciendo trabajo que nadie iba a leer.
      statement_timeout: 5_000,
      // Una transacción que espera un lock más de 3 s falla en lugar de encolar a
      // todos los demás detrás de ella.
      lock_timeout: 3_000,
      // Red de contención contra una transacción olvidada abierta: sin esto, un
      // FOR UPDATE colgado bloquea la fila indefinidamente.
      idle_in_transaction_session_timeout: 10_000,
    },
  };
}

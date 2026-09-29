import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import {
  DataSubjectRequest,
  Notification,
  ProcessedEmail,
  Ticket,
  TicketComment,
  TicketStatusHistory,
  User,
} from '@ticketera/database';

loadEnv({ path: join(process.cwd(), '.env.local') });
loadEnv({ path: join(process.cwd(), '.env') });

/**
 * `DB_NAME` para estos tests tiene que ser una base dedicada, nunca la de
 * desarrollo: `resetDatabase()` (ver `reset-database.ts`) trunca las tablas de
 * dominio completas entre tests. Con un nombre que no contenga "test" ni
 * "integration" ni arranca — es la misma clase de error que ya costó cara con
 * la suite E2E acumulando tickets contra la base compartida (ver CLAUDE.md).
 */
const DB_NAME = process.env.DB_NAME ?? 'ticketera_integration';

if (!/test|integration/i.test(DB_NAME)) {
  throw new Error(
    `DB_NAME='${DB_NAME}' no parece una base de pruebas (no contiene "test" ni ` +
      "\"integration\"). Los tests de integración truncan tablas completas: " +
      'corregí DB_NAME antes de correrlos, para no vaciar una base real.',
  );
}

export const integrationDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: DB_NAME,
  entities: [
    User,
    Ticket,
    TicketComment,
    TicketStatusHistory,
    Notification,
    ProcessedEmail,
    DataSubjectRequest,
  ],
  // Igual que libs/database/src/data-source.ts: el esquema lo arman las
  // migraciones a mano, nunca el schema-builder de TypeORM.
  synchronize: false,
});

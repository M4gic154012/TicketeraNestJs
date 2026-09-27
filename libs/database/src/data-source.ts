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
} from './entities';

// DataSource exclusivo del CLI de TypeORM (migraciones y seeds). La app usa
// buildTypeOrmOptions vía ConfigService; este archivo no se importa en runtime.
loadEnv({ path: join(process.cwd(), '.env.local') });
loadEnv({ path: join(process.cwd(), '.env') });

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
  synchronize: false,
});

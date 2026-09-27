import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AppConfigModule,
  TICKETS_SERVICE,
  USERS_SERVICE,
  buildLoggerConfig,
} from '@ticketera/common';
import { DatabaseModule, ProcessedEmail } from '@ticketera/database';
import { CircuitBreakerModule } from '@ticketera/patterns';
import { LoggerModule } from 'nestjs-pino';
import { IngestEmailUseCase } from './application/use-cases';
import { EmailBodyCleaner, EmailClassifier } from './domain/classification';
import {
  ImapMailboxAdapter,
  MAILBOX_ADAPTER,
  MailboxAdapter,
  SimulatedMailboxAdapter,
} from './domain/strategies/mailbox';
import { EmailIngestionController } from './email-ingestion.controller';
import { ProcessedEmailRepository } from './infrastructure/repositories';
import { MailboxPollerScheduler } from './infrastructure/scheduling';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(buildLoggerConfig('email-ingestion-service')),
    DatabaseModule,
    TypeOrmModule.forFeature([ProcessedEmail]),
    CircuitBreakerModule,
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      {
        name: USERS_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.getOrThrow<string>('USERS_HOST'),
            port: config.getOrThrow<number>('USERS_TCP_PORT'),
          },
        }),
      },
      {
        name: TICKETS_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.getOrThrow<string>('TICKETS_HOST'),
            port: config.getOrThrow<number>('TICKETS_TCP_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [EmailIngestionController],
  providers: [
    ProcessedEmailRepository,
    EmailBodyCleaner,
    IngestEmailUseCase,
    MailboxPollerScheduler,

    // El clasificador necesita saber cuál es su propio buzón (para cortar bucles) y
    // qué dominios acepta.
    {
      provide: EmailClassifier,
      useFactory: (config: ConfigService) =>
        new EmailClassifier(
          config.get<string>('MAIL_ADDRESS') ?? 'soporte@cmm.uchile.cl',
          (config.get<string>('MAIL_ALLOWED_DOMAINS') ?? '')
            .split(',')
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean),
        ),
      inject: [ConfigService],
    },

    // Strategy del proveedor de buzón. El adaptador se elige por configuración:
    // `simulado` permite probar la ingesta completa sin tener el buzón institucional
    // creado, e `imap` es el que se usa cuando la cuenta existe.
    ImapMailboxAdapter,
    SimulatedMailboxAdapter,
    {
      provide: MAILBOX_ADAPTER,
      useFactory: (
        config: ConfigService,
        imap: ImapMailboxAdapter,
        simulado: SimulatedMailboxAdapter,
      ): MailboxAdapter => (config.get<string>('MAIL_ADAPTER') === 'imap' ? imap : simulado),
      inject: [ConfigService, ImapMailboxAdapter, SimulatedMailboxAdapter],
    },
  ],
})
export class EmailIngestionModule {}

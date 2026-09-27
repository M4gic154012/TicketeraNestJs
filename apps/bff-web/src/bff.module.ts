import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  AppConfigModule,
  NOTIFICATIONS_SERVICE,
  TICKETS_SERVICE,
  USERS_SERVICE,
  buildLoggerConfig,
} from '@ticketera/common';
import { CircuitBreakerModule } from '@ticketera/patterns';
import { LoggerModule } from 'nestjs-pino';
import { BffController } from './bff.controller';
import { ServiceClients } from './clients/service.clients';
import {
  AgentDashboardComposer,
  PrivacyDossierComposer,
  TicketDetailComposer,
  TicketListComposer,
} from './composers';

/**
 * El BFF no importa DatabaseModule: no tiene base de datos propia ni acceso a la
 * de nadie. Todo lo obtiene por el transporte, lo que mantiene la frontera real.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(buildLoggerConfig('bff-web')),
    CircuitBreakerModule,
    ClientsModule.registerAsync([
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
        name: NOTIFICATIONS_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.getOrThrow<string>('NOTIFICATIONS_HOST'),
            port: config.getOrThrow<number>('NOTIFICATIONS_TCP_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [BffController],
  providers: [
    ServiceClients,
    TicketDetailComposer,
    AgentDashboardComposer,
    TicketListComposer,
    PrivacyDossierComposer,
  ],
})
export class BffModule {}

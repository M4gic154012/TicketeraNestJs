import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import {
  AppConfigModule,
  NOTIFICATIONS_SERVICE,
  TICKETS_SERVICE,
  USERS_SERVICE,
  buildLoggerConfig,
  registerRpcClient,
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
      registerRpcClient(TICKETS_SERVICE, 'TICKETS_HOST', 'TICKETS_TCP_PORT'),
      registerRpcClient(USERS_SERVICE, 'USERS_HOST', 'USERS_TCP_PORT'),
      registerRpcClient(NOTIFICATIONS_SERVICE, 'NOTIFICATIONS_HOST', 'NOTIFICATIONS_TCP_PORT'),
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

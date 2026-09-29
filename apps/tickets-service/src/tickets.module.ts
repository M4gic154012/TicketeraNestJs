import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ClientsModule } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AppConfigModule,
  NOTIFICATIONS_SERVICE,
  USERS_SERVICE,
  buildLoggerConfig,
  registerRpcClient,
} from '@ticketera/common';
import { DatabaseModule, Ticket, TicketComment, TicketStatusHistory } from '@ticketera/database';
import { CircuitBreakerModule, DomainEventPublisher } from '@ticketera/patterns';
import { LoggerModule } from 'nestjs-pino';
import { TicketFactory } from './domain/factories';
import {
  ASSIGNMENT_STRATEGIES,
  AssignmentStrategyResolver,
  EscalationAssignmentStrategy,
  LeastLoadedAssignmentStrategy,
  SkillBasedAssignmentStrategy,
} from './domain/strategies/assignment';
import {
  BusinessHoursSlaStrategy,
  SLA_STRATEGIES,
  Sla24x7Strategy,
  SlaStrategyResolver,
} from './domain/strategies/sla';
import { UsersClient } from './infrastructure/clients';
import { AuditLogObserver, IntegrationEventForwarder } from './infrastructure/observers';
import { TicketCommentsRepository, TicketsRepository } from './infrastructure/repositories';
import { SlaMonitorScheduler } from './infrastructure/scheduling';
import { TicketsController } from './tickets.controller';
import {
  AddCommentUseCase,
  AgentStatsUseCase,
  AssignTicketUseCase,
  ChangeTicketStatusUseCase,
  CreateTicketUseCase,
  FindCommentsByAuthorUseCase,
  GetTicketDetailUseCase,
  SearchTicketsUseCase,
  SweepSlaBreachesUseCase,
} from './application/use-cases';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(buildLoggerConfig('tickets-service')),
    DatabaseModule,
    TypeOrmModule.forFeature([Ticket, TicketComment, TicketStatusHistory]),
    CircuitBreakerModule,
    // wildcard habilita los observadores con patrón `ticket.*`.
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 20 }),
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      registerRpcClient(USERS_SERVICE, 'USERS_HOST', 'USERS_TCP_PORT'),
      registerRpcClient(NOTIFICATIONS_SERVICE, 'NOTIFICATIONS_HOST', 'NOTIFICATIONS_TCP_PORT'),
    ]),
  ],
  controllers: [TicketsController],
  providers: [
    // Infraestructura
    TicketsRepository,
    TicketCommentsRepository,
    UsersClient,
    DomainEventPublisher,

    // Dominio: factory
    TicketFactory,

    // Dominio: estrategias de asignación. El array multi-provider es lo que
    // permite sumar una estrategia sin tocar el resolver ni los casos de uso.
    SkillBasedAssignmentStrategy,
    LeastLoadedAssignmentStrategy,
    EscalationAssignmentStrategy,
    {
      provide: ASSIGNMENT_STRATEGIES,
      useFactory: (
        skill: SkillBasedAssignmentStrategy,
        leastLoaded: LeastLoadedAssignmentStrategy,
        escalation: EscalationAssignmentStrategy,
      ) => [escalation, skill, leastLoaded],
      inject: [
        SkillBasedAssignmentStrategy,
        LeastLoadedAssignmentStrategy,
        EscalationAssignmentStrategy,
      ],
    },
    AssignmentStrategyResolver,

    // Dominio: estrategias de SLA
    BusinessHoursSlaStrategy,
    Sla24x7Strategy,
    {
      provide: SLA_STRATEGIES,
      useFactory: (businessHours: BusinessHoursSlaStrategy, always: Sla24x7Strategy) => [
        always,
        businessHours,
      ],
      inject: [BusinessHoursSlaStrategy, Sla24x7Strategy],
    },
    SlaStrategyResolver,

    // Capa de servicio (un provider por caso de uso)
    CreateTicketUseCase,
    AssignTicketUseCase,
    ChangeTicketStatusUseCase,
    AddCommentUseCase,
    SearchTicketsUseCase,
    GetTicketDetailUseCase,
    SweepSlaBreachesUseCase,
    AgentStatsUseCase,
    FindCommentsByAuthorUseCase,

    // Observadores
    IntegrationEventForwarder,
    AuditLogObserver,

    // Tareas programadas
    SlaMonitorScheduler,
  ],
})
export class TicketsModule {}

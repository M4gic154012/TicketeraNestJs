import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AppConfigModule,
  USERS_SERVICE,
  buildLoggerConfig,
  registerRpcClient,
} from '@ticketera/common';
import { DatabaseModule, Notification } from '@ticketera/database';
import { ScheduleModule } from '@nestjs/schedule';
import { CircuitBreakerModule } from '@ticketera/patterns';
import { LoggerModule } from 'nestjs-pino';
import {
  HandleDomainEventUseCase,
  ListNotificationsUseCase,
  MarkAsReadUseCase,
} from './application/use-cases';
import { NotificationFactory } from './domain/factories';
import {
  CHANNEL_STRATEGIES,
  ChannelStrategyResolver,
  EmailChannelStrategy,
  InAppChannelStrategy,
} from './domain/strategies';
import { NotificationsRepository } from './infrastructure/repositories';
import { NotificationRetentionScheduler } from './infrastructure/retention.scheduler';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(buildLoggerConfig('notifications-service')),
    DatabaseModule,
    TypeOrmModule.forFeature([Notification]),
    CircuitBreakerModule,
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([registerRpcClient(USERS_SERVICE, 'USERS_HOST', 'USERS_TCP_PORT')]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationFactory,
    InAppChannelStrategy,
    EmailChannelStrategy,
    {
      provide: CHANNEL_STRATEGIES,
      useFactory: (inApp: InAppChannelStrategy, email: EmailChannelStrategy) => [email, inApp],
      inject: [InAppChannelStrategy, EmailChannelStrategy],
    },
    ChannelStrategyResolver,
    HandleDomainEventUseCase,
    ListNotificationsUseCase,
    MarkAsReadUseCase,
    NotificationRetentionScheduler,
  ],
})
export class NotificationsModule {}

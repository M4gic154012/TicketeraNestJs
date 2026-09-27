import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule, buildLoggerConfig } from '@ticketera/common';
import { DatabaseModule, DataSubjectRequest, User } from '@ticketera/database';
import { LoggerModule } from 'nestjs-pino';
import {
  AnonymizeUserUseCase,
  CreateUserUseCase,
  FindOrCreateByEmailUseCase,
  FindUsersUseCase,
  GetUserUseCase,
  ListDataSubjectRequestsUseCase,
  RegisterOppositionUseCase,
  SetPrivacyBlockUseCase,
  UpdateUserProfileUseCase,
  ValidateCredentialsUseCase,
} from './application/use-cases';
import { UserFactory } from './domain/factories';
import { DataSubjectRequestsRepository, UsersRepository } from './infrastructure/repositories';
import { UsersController } from './users.controller';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(buildLoggerConfig('users-service')),
    DatabaseModule,
    TypeOrmModule.forFeature([User, DataSubjectRequest]),
  ],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    DataSubjectRequestsRepository,
    UserFactory,
    CreateUserUseCase,
    FindUsersUseCase,
    GetUserUseCase,
    ValidateCredentialsUseCase,
    FindOrCreateByEmailUseCase,
    UpdateUserProfileUseCase,
    AnonymizeUserUseCase,
    SetPrivacyBlockUseCase,
    RegisterOppositionUseCase,
    ListDataSubjectRequestsUseCase,
  ],
})
export class UsersModule {}

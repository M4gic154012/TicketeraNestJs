import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { USERS_PATTERNS } from '@ticketera/common';
import {
  AnonymizeUserCommand,
  AnonymizeUserResult,
  CreateUserCommand,
  DataSubjectRequestView,
  FindManyUsersQuery,
  ListDataSubjectRequestsQuery,
  RegisterOppositionCommand,
  RegisterOppositionResult,
  SetPrivacyBlockCommand,
  UpdateUserProfileCommand,
  UserView,
  ValidateCredentialsCommand,
} from './application/dto';
import {
  AnonymizeUserUseCase,
  CreateUserUseCase,
  FindOrCreateByEmailCommand,
  FindOrCreateByEmailUseCase,
  FindUsersUseCase,
  GetUserUseCase,
  ListDataSubjectRequestsUseCase,
  RegisterOppositionUseCase,
  SetPrivacyBlockUseCase,
  UpdateUserProfileUseCase,
  ValidateCredentialsUseCase,
} from './application/use-cases';

@Controller()
export class UsersController {
  constructor(
    private readonly createUser: CreateUserUseCase,
    private readonly findUsers: FindUsersUseCase,
    private readonly getUser: GetUserUseCase,
    private readonly validateCredentials: ValidateCredentialsUseCase,
    private readonly findOrCreateByEmail: FindOrCreateByEmailUseCase,
    private readonly updateUserProfile: UpdateUserProfileUseCase,
    private readonly anonymizeUser: AnonymizeUserUseCase,
    private readonly setPrivacyBlock: SetPrivacyBlockUseCase,
    private readonly registerOpposition: RegisterOppositionUseCase,
    private readonly listDataSubjectRequests: ListDataSubjectRequestsUseCase,
  ) {}

  @MessagePattern(USERS_PATTERNS.create)
  create(@Payload() command: CreateUserCommand): Promise<UserView> {
    return this.createUser.execute(command);
  }

  @MessagePattern(USERS_PATTERNS.findById)
  findById(@Payload() payload: { id: string }): Promise<UserView> {
    return this.getUser.execute({ id: payload.id });
  }

  @MessagePattern(USERS_PATTERNS.findByEmail)
  findByEmail(@Payload() payload: { email: string }): Promise<UserView> {
    return this.getUser.execute({ email: payload.email });
  }

  @MessagePattern(USERS_PATTERNS.findMany)
  findMany(@Payload() query: FindManyUsersQuery): Promise<UserView[]> {
    return this.findUsers.execute(query);
  }

  /** Lo usa la ingesta por correo: el remitente puede no estar dado de alta. */
  @MessagePattern(USERS_PATTERNS.findOrCreateByEmail)
  findOrCreate(
    @Payload() command: FindOrCreateByEmailCommand,
  ): Promise<UserView & { created: boolean }> {
    return this.findOrCreateByEmail.execute(command);
  }

  @MessagePattern(USERS_PATTERNS.validateCredentials)
  validate(@Payload() command: ValidateCredentialsCommand): Promise<UserView> {
    return this.validateCredentials.execute(command);
  }

  // --- Derechos ARCO + portabilidad + bloqueo (Ley 21.719) -----------------

  @MessagePattern(USERS_PATTERNS.updateProfile)
  updateProfile(@Payload() command: UpdateUserProfileCommand): Promise<UserView> {
    return this.updateUserProfile.execute(command);
  }

  @MessagePattern(USERS_PATTERNS.anonymize)
  anonymize(@Payload() command: AnonymizeUserCommand): Promise<AnonymizeUserResult> {
    return this.anonymizeUser.execute(command);
  }

  @MessagePattern(USERS_PATTERNS.setPrivacyBlock)
  setBlock(@Payload() command: SetPrivacyBlockCommand): Promise<UserView> {
    return this.setPrivacyBlock.execute(command);
  }

  @MessagePattern(USERS_PATTERNS.registerOpposition)
  oppose(@Payload() command: RegisterOppositionCommand): Promise<RegisterOppositionResult> {
    return this.registerOpposition.execute(command);
  }

  @MessagePattern(USERS_PATTERNS.listDataSubjectRequests)
  requestHistory(
    @Payload() query: ListDataSubjectRequestsQuery,
  ): Promise<DataSubjectRequestView[]> {
    return this.listDataSubjectRequests.execute(query);
  }
}

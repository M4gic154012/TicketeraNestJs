import { Injectable } from '@nestjs/common';
import {
  BusinessRuleViolationError,
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  EntityNotFoundError,
  assertCanRectify,
} from '@ticketera/common';
import { TypeOrmUnitOfWork } from '@ticketera/database';
import { ApplicationService } from '@ticketera/patterns';
import { DataSubjectRequestsRepository, UsersRepository } from '../../infrastructure/repositories';
import { UpdateUserProfileCommand, UserView, toUserView } from '../dto';

/**
 * Rectificación (ARCO): corrige los datos identificadores propios del
 * titular. Deliberadamente NO acepta `role`, `skills`, `maxConcurrentTickets`
 * ni `isActive` — son atributos operativos de negocio, no identificadores
 * personales; esos siguen siendo resorte de un ADMIN por otra vía.
 */
@Injectable()
export class UpdateUserProfileUseCase extends ApplicationService<
  UpdateUserProfileCommand,
  UserView
> {
  constructor(
    private readonly users: UsersRepository,
    private readonly requests: DataSubjectRequestsRepository,
    private readonly uow: TypeOrmUnitOfWork,
  ) {
    super();
  }

  async execute(command: UpdateUserProfileCommand): Promise<UserView> {
    assertCanRectify({ id: command.actorId, role: command.actorRole }, command.targetUserId);

    const user = await this.users.findById(command.targetUserId);
    if (!user) throw new EntityNotFoundError('Usuario', command.targetUserId);

    if (user.isAnonymized()) {
      throw new BusinessRuleViolationError('No se puede rectificar una cuenta ya suprimida', {
        targetUserId: command.targetUserId,
      });
    }

    if (command.email !== undefined) {
      const email = command.email.trim().toLowerCase();
      if (email !== user.email && (await this.users.emailExists(email))) {
        throw new BusinessRuleViolationError('Ya existe un usuario con ese email', { email });
      }
      user.email = email;
    }
    if (command.fullName !== undefined) user.fullName = command.fullName.trim();
    if (command.department !== undefined) user.department = command.department.trim() || null;

    const saved = await this.uow.runInTransaction(async (ctx) => {
      const savedUser = await this.users.saveWithManager(user, ctx.manager);
      await this.requests.recordWithManager(
        {
          subjectUserId: command.targetUserId,
          requestedByUserId: command.actorId,
          type: DataSubjectRequestType.RECTIFICATION,
          status: DataSubjectRequestStatus.COMPLETED,
          resolvedAt: new Date(),
        },
        ctx.manager,
      );
      return savedUser;
    });

    return toUserView(saved);
  }
}

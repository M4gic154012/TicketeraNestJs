import { Injectable } from '@nestjs/common';
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  EntityNotFoundError,
  ValidationError,
  assertCanBlock,
  assertCanUnblock,
} from '@ticketera/common';
import { TypeOrmUnitOfWork } from '@ticketera/database';
import { ApplicationService } from '@ticketera/patterns';
import { DataSubjectRequestsRepository, UsersRepository } from '../../infrastructure/repositories';
import { SetPrivacyBlockCommand, UserView, toUserView } from '../dto';

/**
 * Bloqueo temporal del tratamiento de datos, independiente de `isActive`
 * (ver comentario de `User.privacyBlockedAt`). Lo usan tanto el bloqueo
 * directo como la autoaplicación de una oposición del propio titular
 * (`RegisterOppositionUseCase`).
 */
@Injectable()
export class SetPrivacyBlockUseCase extends ApplicationService<SetPrivacyBlockCommand, UserView> {
  constructor(
    private readonly users: UsersRepository,
    private readonly requests: DataSubjectRequestsRepository,
    private readonly uow: TypeOrmUnitOfWork,
  ) {
    super();
  }

  async execute(command: SetPrivacyBlockCommand): Promise<UserView> {
    const actor = { id: command.actorId, role: command.actorRole };
    if (command.blocked) {
      assertCanBlock(actor, command.targetUserId);
      if (!command.reason?.trim()) {
        throw new ValidationError('El bloqueo de privacidad requiere un motivo');
      }
    } else {
      assertCanUnblock(actor, command.targetUserId);
    }

    const user = await this.users.findById(command.targetUserId);
    if (!user) throw new EntityNotFoundError('Usuario', command.targetUserId);

    if (command.blocked) {
      user.blockPrivacy(command.reason as string);
    } else {
      user.unblockPrivacy();
    }

    const saved = await this.uow.runInTransaction(async (ctx) => {
      const savedUser = await this.users.saveWithManager(user, ctx.manager);
      await this.requests.recordWithManager(
        {
          subjectUserId: command.targetUserId,
          requestedByUserId: command.actorId,
          type: command.blocked ? DataSubjectRequestType.BLOCK : DataSubjectRequestType.UNBLOCK,
          status: DataSubjectRequestStatus.COMPLETED,
          reason: command.reason ?? null,
          resolvedAt: new Date(),
        },
        ctx.manager,
      );
      return savedUser;
    });

    return toUserView(saved);
  }
}

import { Injectable } from '@nestjs/common';
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  EntityNotFoundError,
  assertCanOppose,
} from '@ticketera/common';
import { TypeOrmUnitOfWork } from '@ticketera/database';
import { ApplicationService } from '@ticketera/patterns';
import { DataSubjectRequestsRepository, UsersRepository } from '../../infrastructure/repositories';
import { RegisterOppositionCommand, RegisterOppositionResult } from '../dto';

/**
 * Oposición (ARCO): es evaluable, no un alias de bloqueo. El responsable puede
 * rechazarla si hay un motivo legítimo que prevalece (p. ej. tickets abiertos
 * que requieren seguir dando soporte), así que solo se autoaplica el bloqueo
 * cuando el propio titular actúa sobre sí mismo (aceptación automática de su
 * propia solicitud). Si actúa un ADMIN en representación, se registra pero el
 * bloqueo efectivo requiere una llamada posterior explícita a
 * `SetPrivacyBlockUseCase` — no se automatiza una decisión que la ley espera
 * que evalúe el responsable.
 */
@Injectable()
export class RegisterOppositionUseCase extends ApplicationService<
  RegisterOppositionCommand,
  RegisterOppositionResult
> {
  constructor(
    private readonly users: UsersRepository,
    private readonly requests: DataSubjectRequestsRepository,
    private readonly uow: TypeOrmUnitOfWork,
  ) {
    super();
  }

  async execute(command: RegisterOppositionCommand): Promise<RegisterOppositionResult> {
    assertCanOppose({ id: command.actorId, role: command.actorRole }, command.targetUserId);

    const user = await this.users.findById(command.targetUserId);
    if (!user) throw new EntityNotFoundError('Usuario', command.targetUserId);

    const actsOnSelf = command.actorId === command.targetUserId;
    const status = actsOnSelf ? DataSubjectRequestStatus.COMPLETED : DataSubjectRequestStatus.RECEIVED;

    // Misma transacción cuando hay autoaplicación de bloqueo: si el registro de
    // la oposición no se confirma, el bloqueo tampoco debe quedar aplicado.
    const saved = await this.uow.runInTransaction(async (ctx) => {
      if (actsOnSelf) {
        user.blockPrivacy(`Oposición: ${command.reason}`);
        await this.users.saveWithManager(user, ctx.manager);
      }

      return this.requests.recordWithManager(
        {
          subjectUserId: command.targetUserId,
          requestedByUserId: command.actorId,
          type: DataSubjectRequestType.OPPOSITION,
          status,
          reason: command.reason,
          resolvedAt: actsOnSelf ? new Date() : null,
        },
        ctx.manager,
      );
    });

    return { requestId: saved.id, status };
  }
}

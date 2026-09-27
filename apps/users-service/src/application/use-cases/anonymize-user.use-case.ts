import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataSubjectRequestStatus,
  DataSubjectRequestType,
  EntityNotFoundError,
  assertCanCancel,
} from '@ticketera/common';
import { TypeOrmUnitOfWork } from '@ticketera/database';
import { ApplicationService } from '@ticketera/patterns';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSubjectRequestsRepository, UsersRepository } from '../../infrastructure/repositories';
import { AnonymizeUserCommand, AnonymizeUserResult } from '../dto';

/**
 * Cancelación (ARCO): NUNCA borra la fila (las FK RESTRICT de
 * `tickets.requesterId`/`ticket_comments.authorId` lo impiden, y aunque no lo
 * impidieran, borrar rompería el historial de soporte de terceros). En vez de
 * eso reemplaza los campos identificables por placeholders estables — ver
 * `User.anonymize()`.
 *
 * El texto libre de tickets/comentarios que este usuario escribió NO se toca:
 * `tickets-service` siempre hace JOIN en vivo contra `users.fullName`/
 * `users.email`, así que anonimizar esta única fila alcanza para que todas
 * las vistas de detalle muestren el placeholder.
 */
@Injectable()
export class AnonymizeUserUseCase extends ApplicationService<
  AnonymizeUserCommand,
  AnonymizeUserResult
> {
  constructor(
    private readonly users: UsersRepository,
    private readonly requests: DataSubjectRequestsRepository,
    private readonly uow: TypeOrmUnitOfWork,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async execute(command: AnonymizeUserCommand): Promise<AnonymizeUserResult> {
    assertCanCancel({ id: command.actorId, role: command.actorRole }, command.targetUserId);

    const user = await this.users.findById(command.targetUserId);
    if (!user) throw new EntityNotFoundError('Usuario', command.targetUserId);

    // Idempotente: una segunda solicitud del mismo titular no debe fallar.
    if (!user.isAnonymized()) {
      const unusablePasswordHash = await bcrypt.hash(
        randomUUID(),
        this.config.get<number>('BCRYPT_ROUNDS') ?? 12,
      );
      user.anonymize(unusablePasswordHash);

      // Misma transacción: si el asiento de auditoría no se confirma, la
      // anonimización (irreversible) tampoco debe quedar confirmada. Antes eran
      // dos escrituras independientes — un fallo entre medio dejaba la cuenta
      // anonimizada sin ningún rastro de que la solicitud ocurrió.
      await this.uow.runInTransaction(async (ctx) => {
        await this.users.saveWithManager(user, ctx.manager);
        await this.requests.recordWithManager(
          {
            subjectUserId: command.targetUserId,
            requestedByUserId: command.actorId,
            type: DataSubjectRequestType.CANCELLATION,
            status: DataSubjectRequestStatus.COMPLETED,
            reason: command.reason,
            resolvedAt: new Date(),
          },
          ctx.manager,
        );
      });

      this.logger.log(`Usuario ${command.targetUserId} anonimizado (cancelación ARCO)`);
    }

    return { id: user.id, anonymizedAt: (user.anonymizedAt as Date).toISOString() };
  }
}

import { Injectable } from '@nestjs/common';
import {
  EntityNotFoundError,
  TicketStatus,
  UnauthorizedActionError,
  ValidationError,
  canAddInternalNote,
  canComment,
} from '@ticketera/common';
import { TicketComment, TypeOrmUnitOfWork } from '@ticketera/database';
import { ApplicationService, DomainEventPublisher } from '@ticketera/patterns';
import { randomUUID } from 'node:crypto';
import { TicketsRepository } from '../../infrastructure/repositories';
import { AddCommentCommand, TicketCommentView } from '../dto';

/**
 * Caso de uso: comentar un ticket.
 *
 * Una nota interna solo la puede escribir alguien del equipo de soporte: si el
 * solicitante pudiera marcarla como interna, vería algo que no le corresponde al
 * releerla.
 */
@Injectable()
export class AddCommentUseCase extends ApplicationService<AddCommentCommand, TicketCommentView> {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly uow: TypeOrmUnitOfWork,
    private readonly events: DomainEventPublisher,
  ) {
    super();
  }

  /**
   * Quién puede comentar un ticket. Delega en las reglas compartidas de
   * `libs/common` para no divergir del BFF ni del resto de los casos de uso.
   *
   * Fail-closed: sin esta comprobación, cualquier usuario autenticado podía comentar
   * cualquier ticket conociendo su id — el gateway no valida rol en esta ruta porque
   * el solicitante legítimo también necesita comentar.
   */
  private assertCanComment(
    command: AddCommentCommand,
    assigneeId: string | null,
    requesterId: string,
    status: TicketStatus,
  ): void {
    const actor = { id: command.authorId, role: command.authorRole };
    const context = { requesterId, assigneeId, status };

    if (!canComment(actor, context)) {
      throw new UnauthorizedActionError('No tiene permiso para comentar este ticket', {
        ticketId: command.ticketId,
      });
    }

    if (command.isInternal && !canAddInternalNote(actor)) {
      throw new UnauthorizedActionError('El solicitante no puede crear notas internas', {
        ticketId: command.ticketId,
      });
    }
  }

  async execute(command: AddCommentCommand): Promise<TicketCommentView> {
    const body = command.body.trim();
    if (body.length === 0) {
      throw new ValidationError('El comentario no puede estar vacío');
    }
    if (body.length > 10_000) {
      throw new ValidationError('El comentario excede el largo máximo (10000 caracteres)');
    }

    const comment = new TicketComment();
    comment.id = randomUUID();
    comment.ticketId = command.ticketId;
    comment.authorId = command.authorId;
    comment.body = body;
    comment.isInternal = command.isInternal ?? false;
    comment.sourceMessageId = command.sourceMessageId ?? null;
    comment.createdAt = new Date();

    const saved = await this.uow.runInTransaction(async (ctx) => {
      const manager = ctx.manager;

      const ticket = await this.tickets.findByIdForUpdate(command.ticketId, manager);
      if (!ticket) throw new EntityNotFoundError('Ticket', command.ticketId);

      this.assertCanComment(command, ticket.assigneeId, ticket.requesterId, ticket.status);

      // El agregado decide si acepta el comentario (p. ej. lo rechaza si está
      // cerrado) y registra el evento correspondiente.
      ticket.addComment(comment);
      await manager.save(TicketComment, comment);
      await this.tickets.saveWithManager(ticket, manager);
      return ticket;
    });

    await this.events.publishFrom(saved);

    return {
      id: comment.id,
      body: comment.body,
      isInternal: comment.isInternal,
      author: null,
      createdAt: comment.createdAt.toISOString(),
    };
  }
}

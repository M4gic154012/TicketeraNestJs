import { Injectable } from '@nestjs/common';
import { ApplicationService } from '@ticketera/patterns';
import { TicketCommentByAuthorSpec } from '../../domain/specifications';
import { TicketCommentsRepository } from '../../infrastructure/repositories';

export interface FindCommentsByAuthorQuery {
  authorId: string;
}

export interface AuthoredCommentView {
  commentId: string;
  ticketId: string;
  ticketCode: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
}

/**
 * Soporte del dossier de acceso/portabilidad ARCO. Sin `assertCan*` propia: la
 * autorización de "quién puede ver el dossier de quién" ya se resolvió antes
 * de llegar acá (gateway + `assertCanAccess` en `users-service`) — este RPC
 * solo lo llama el BFF, autenticado con `RPC_SHARED_SECRET`.
 */
@Injectable()
export class FindCommentsByAuthorUseCase extends ApplicationService<
  FindCommentsByAuthorQuery,
  AuthoredCommentView[]
> {
  constructor(private readonly comments: TicketCommentsRepository) {
    super();
  }

  async execute(query: FindCommentsByAuthorQuery): Promise<AuthoredCommentView[]> {
    const comments = await this.comments.findAll(new TicketCommentByAuthorSpec(query.authorId));

    return comments.map((comment) => ({
      commentId: comment.id,
      ticketId: comment.ticketId,
      ticketCode: comment.ticket?.code ?? '',
      body: comment.body,
      isInternal: comment.isInternal,
      createdAt: comment.createdAt.toISOString(),
    }));
  }
}

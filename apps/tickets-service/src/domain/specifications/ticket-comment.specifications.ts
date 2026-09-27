import { TicketComment } from '@ticketera/database';
import { CompositeSpecification } from '@ticketera/patterns';
import { SelectQueryBuilder } from 'typeorm';

/** Soporte del dossier de acceso/portabilidad ARCO: comentarios de un autor. */
export class TicketCommentByAuthorSpec extends CompositeSpecification<TicketComment> {
  constructor(private readonly authorId: string) {
    super();
  }

  isSatisfiedBy(comment: TicketComment): boolean {
    return comment.authorId === this.authorId;
  }

  applyTo(
    qb: SelectQueryBuilder<TicketComment>,
    alias: string,
  ): SelectQueryBuilder<TicketComment> {
    return qb.andWhere(`${alias}.authorId = :authorId`, { authorId: this.authorId });
  }
}

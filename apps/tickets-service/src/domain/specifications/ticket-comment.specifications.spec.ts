import { TicketComment } from '@ticketera/database';
import { randomUUID } from 'node:crypto';
import { TicketCommentByAuthorSpec } from './ticket-comment.specifications';

describe('TicketCommentByAuthorSpec', () => {
  const build = (authorId: string): TicketComment => {
    const comment = new TicketComment();
    comment.id = randomUUID();
    comment.ticketId = randomUUID();
    comment.authorId = authorId;
    comment.body = 'comentario de prueba';
    comment.isInternal = false;
    comment.sourceMessageId = null;
    return comment;
  };

  it('filtra por autor', () => {
    const authorId = randomUUID();
    const spec = new TicketCommentByAuthorSpec(authorId);

    expect(spec.isSatisfiedBy(build(authorId))).toBe(true);
    expect(spec.isSatisfiedBy(build(randomUUID()))).toBe(false);
  });
});

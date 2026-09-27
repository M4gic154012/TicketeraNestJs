import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, UnauthorizedActionError, UserRole } from '@ticketera/common';
import { ApplicationService } from '@ticketera/patterns';
import { TicketsRepository } from '../../infrastructure/repositories';
import { TicketDetailView, toTicketDetail } from '../dto';

export interface GetTicketDetailQuery {
  ticketId: string;
  /** Quién consulta: determina si ve notas internas y si puede ver el ticket. */
  viewerId: string;
  viewerRole: UserRole;
}

/**
 * Caso de uso: detalle de un ticket.
 *
 * La autorización va acá y no en el gateway porque depende del dato: el gateway
 * sabe el rol, pero no si este ticket en particular es del solicitante.
 */
@Injectable()
export class GetTicketDetailUseCase extends ApplicationService<
  GetTicketDetailQuery,
  TicketDetailView
> {
  constructor(private readonly tickets: TicketsRepository) {
    super();
  }

  async execute(query: GetTicketDetailQuery): Promise<TicketDetailView> {
    const ticket = await this.tickets.findByIdWithDetail(query.ticketId);
    if (!ticket) throw new EntityNotFoundError('Ticket', query.ticketId);

    const isSupportStaff = query.viewerRole !== UserRole.REQUESTER;
    const isOwnTicket = ticket.requesterId === query.viewerId;

    if (!isSupportStaff && !isOwnTicket) {
      // Mismo mensaje que un ticket inexistente sería preferible para no
      // revelar que existe; se usa 403 explícito porque el id es un uuid que el
      // usuario solo puede conocer si se lo compartieron.
      throw new UnauthorizedActionError('No tiene acceso a este ticket', {
        ticketId: query.ticketId,
      });
    }

    return toTicketDetail(ticket, isSupportStaff);
  }
}

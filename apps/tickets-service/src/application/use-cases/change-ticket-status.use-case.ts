import { Injectable } from '@nestjs/common';
import {
  EntityNotFoundError,
  InvalidStateTransitionError,
  TicketStatus,
  UnauthorizedActionError,
  allowedNextStatuses,
} from '@ticketera/common';
import { TypeOrmUnitOfWork } from '@ticketera/database';
import { ApplicationService, DomainEventPublisher } from '@ticketera/patterns';
import { TicketsRepository } from '../../infrastructure/repositories';
import { ChangeTicketStatusCommand, TicketSummaryView, toTicketSummary } from '../dto';

/**
 * Caso de uso: cambiar el estado de un ticket.
 *
 * La legalidad de la transición la decide el agregado (`ticket.changeStatus`).
 * Acá solo se resuelve quién tiene derecho a pedirla y se acota la transacción.
 */
@Injectable()
export class ChangeTicketStatusUseCase extends ApplicationService<
  ChangeTicketStatusCommand,
  TicketSummaryView
> {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly uow: TypeOrmUnitOfWork,
    private readonly events: DomainEventPublisher,
  ) {
    super();
  }

  async execute(command: ChangeTicketStatusCommand): Promise<TicketSummaryView> {
    const saved = await this.uow.runInTransaction(async (ctx) => {
      const manager = ctx.manager;

      const ticket = await this.tickets.findByIdForUpdate(command.ticketId, manager);
      if (!ticket) throw new EntityNotFoundError('Ticket', command.ticketId);

      this.assertCanChange(command, ticket.assigneeId, ticket.requesterId, ticket.status);

      ticket.changeStatus(command.status, command.changedById, command.reason);
      return this.tickets.saveWithManager(ticket, manager);
    });

    await this.events.publishFrom(saved);

    return toTicketSummary((await this.tickets.findById(saved.id)) ?? saved);
  }

  /**
   * Autorización del caso de uso. Depende del dato, no solo del rol, así que no
   * puede resolverse en el gateway: el gateway sabe que quien llama es agente,
   * pero no si ESTE ticket es suyo.
   *
   * Delega en `allowedNextStatuses` (libs/common) en lugar de reimplementar las
   * reglas: son las mismas que el BFF le informa al cliente, y tenerlas dos veces
   * garantizaba que se desincronizaran — pasó.
   *
   * Es fail-closed: si el estado pedido no está en la lista de alcanzables para este
   * actor, se rechaza. La versión original dejaba pasar a los "terceros" asumiendo
   * que el gateway ya había validado el rol, y el gateway no lo hacía.
   */
  private assertCanChange(
    command: ChangeTicketStatusCommand,
    assigneeId: string | null,
    requesterId: string,
    currentStatus: TicketStatus,
  ): void {
    const allowed = allowedNextStatuses(
      { id: command.changedById, role: command.changedByRole },
      { requesterId, assigneeId, status: currentStatus },
    );

    if (allowed.length === 0) {
      throw new UnauthorizedActionError(
        'No tiene permiso para cambiar el estado de este ticket',
        { ticketId: command.ticketId },
      );
    }

    if (!allowed.includes(command.status)) {
      // 409 y no 403: el actor tiene relación con el ticket, pero ese salto concreto
      // no es válido para él. Se le dice cuáles sí, para que el cliente no adivine.
      throw new InvalidStateTransitionError(currentStatus, command.status, allowed);
    }
  }
}

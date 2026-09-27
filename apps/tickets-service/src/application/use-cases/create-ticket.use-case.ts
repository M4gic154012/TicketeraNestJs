import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, UserRole } from '@ticketera/common';
import { Ticket, TypeOrmUnitOfWork } from '@ticketera/database';
import { ApplicationService, DomainEventPublisher } from '@ticketera/patterns';
import { TicketFactory } from '../../domain/factories';
import { SlaStrategyResolver } from '../../domain/strategies/sla';
import { UsersClient } from '../../infrastructure/clients';
import { TicketsRepository } from '../../infrastructure/repositories';
import { CreateTicketCommand, TicketSummaryView, toTicketSummary } from '../dto';
import { AssignTicketUseCase } from './assign-ticket.use-case';

/**
 * Caso de uso: crear ticket.
 *
 * Orquesta y nada más — el SLA lo calcula una estrategia, el ticket lo construye
 * la factory, la asignación la delega a su propio caso de uso. Esta clase solo
 * decide el orden y los límites de la transacción.
 */
@Injectable()
export class CreateTicketUseCase extends ApplicationService<
  CreateTicketCommand,
  TicketSummaryView
> {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly users: UsersClient,
    private readonly factory: TicketFactory,
    private readonly slaResolver: SlaStrategyResolver,
    private readonly uow: TypeOrmUnitOfWork,
    private readonly events: DomainEventPublisher,
    private readonly assignUseCase: AssignTicketUseCase,
  ) {
    super();
  }

  async execute(command: CreateTicketCommand): Promise<TicketSummaryView> {
    const requester = await this.users.findById(command.requesterId);
    if (!requester) {
      throw new EntityNotFoundError('Usuario solicitante', command.requesterId);
    }

    // La prioridad efectiva se resuelve antes del SLA: la heurística de urgencia
    // puede elevarla, y el vencimiento debe corresponder a la prioridad real.
    const effectivePriority = this.factory.resolvePriority({
      title: command.title,
      description: command.description,
      requestedPriority: command.priority,
    });

    const sla = await this.slaResolver.calculate({
      priority: effectivePriority,
      category: command.category,
      createdAt: new Date(),
      // Los pedidos de dirección y gerencia entran con atención continua.
      isVipRequester:
        requester.role === UserRole.ADMIN || requester.department === 'Dirección',
    });

    const ticket = await this.uow.runInTransaction(async (ctx) => {
      const manager = ctx.manager;
      const sequence = await this.tickets.nextTicketSequence(manager);

      const created = this.factory.create({
        title: command.title,
        description: command.description,
        requesterId: command.requesterId,
        category: command.category,
        requestedPriority: command.priority,
        tags: command.tags,
        sla,
        sequence,
        sourceChannel: command.sourceChannel,
        sourceMessageId: command.sourceMessageId,
      });

      return this.tickets.saveWithManager(created, manager);
    });

    // Los eventos se publican después del commit: un observador no debe
    // reaccionar a un ticket que todavía puede desaparecer por rollback.
    await this.events.publishFrom(ticket);

    this.logger.log(`Ticket ${ticket.code} creado por ${requester.email}`);

    if (command.autoAssign) {
      // Si la asignación falla, el ticket ya existe y queda en la cola sin
      // dueño: preferimos eso a perder el reporte del usuario.
      try {
        await this.assignUseCase.execute({
          ticketId: ticket.id,
          requestedById: command.requesterId,
          // La autoasignación la decide el sistema, no el solicitante: se ejecuta
          // con rol de administrador porque el ticket recién creado no tiene dueño
          // y ningún usuario está pidiendo esto explícitamente.
          requestedByRole: UserRole.ADMIN,
        });
      } catch (error) {
        this.logger.warn(
          `Ticket ${ticket.code} creado pero sin asignar: ${(error as Error).message}`,
        );
      }
    }

    return toTicketSummary(await this.reload(ticket));
  }

  /** Recarga con relaciones para devolver la vista completa al cliente. */
  private async reload(ticket: Ticket): Promise<Ticket> {
    return (await this.tickets.findById(ticket.id)) ?? ticket;
  }
}

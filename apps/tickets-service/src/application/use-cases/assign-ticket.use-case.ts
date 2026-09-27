import { Injectable } from '@nestjs/common';
import {
  BusinessRuleViolationError,
  EntityNotFoundError,
  UnauthorizedActionError,
  canReassign,
} from '@ticketera/common';
import { Ticket, TypeOrmUnitOfWork, User } from '@ticketera/database';
import { ApplicationService, DomainEventPublisher } from '@ticketera/patterns';
import { AgentWorkload, AssignmentStrategyResolver } from '../../domain/strategies/assignment';
import { UsersClient } from '../../infrastructure/clients';
import { TicketsRepository } from '../../infrastructure/repositories';
import { AssignTicketCommand, TicketSummaryView, toTicketSummary } from '../dto';

/**
 * Caso de uso: asignar ticket.
 *
 * Dos modos: manual (un supervisor elige el agente) y automático (deciden las
 * estrategias).
 *
 * Orden deliberado: **todo lo que sale por la red se resuelve ANTES de abrir la
 * transacción.** La versión anterior tomaba el lock de la fila y después llamaba
 * a users-service, así que el ticket quedaba bloqueado durante toda la latencia
 * de otro servicio (hasta el timeout del circuit breaker), y además pedía una
 * segunda conexión del pool estando dentro de la transacción — con 10 asignaciones
 * concurrentes eso agota el pool contra sí mismo.
 *
 * Dentro de la transacción solo queda: leer con lock, decidir con datos ya en
 * memoria, escribir. El agente elegido se revalida contra el ticket bloqueado.
 */
@Injectable()
export class AssignTicketUseCase extends ApplicationService<
  AssignTicketCommand,
  TicketSummaryView
> {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly users: UsersClient,
    private readonly resolver: AssignmentStrategyResolver,
    private readonly uow: TypeOrmUnitOfWork,
    private readonly events: DomainEventPublisher,
  ) {
    super();
  }

  async execute(command: AssignTicketCommand): Promise<TicketSummaryView> {
    // --- Fase 1: fuera de la transacción. Red y lecturas sin lock. ---
    const ticket = await this.tickets.findById(command.ticketId);
    if (!ticket) throw new EntityNotFoundError('Ticket', command.ticketId);

    // Este caso de uso NO tenía ninguna comprobación: recibía `requestedById` y no
    // lo usaba, así que cualquier agente podía arrebatarle un ticket a otro. La
    // regla es la misma que el BFF informa al cliente (libs/common).
    if (
      !canReassign(
        { id: command.requestedById, role: command.requestedByRole },
        {
          requesterId: ticket.requesterId,
          assigneeId: ticket.assigneeId,
          status: ticket.status,
        },
      )
    ) {
      throw new UnauthorizedActionError('No tiene permiso para asignar este ticket', {
        ticketId: command.ticketId,
      });
    }

    const candidate = command.assigneeId
      ? await this.resolveManual(command.assigneeId)
      : await this.resolveAutomatic(ticket);

    // --- Fase 2: transacción corta, sin salidas a la red. ---
    const saved = await this.uow.runInTransaction(async (ctx) => {
      const manager = ctx.manager;

      // Se relee con lock: entre la fase 1 y esta línea el ticket pudo cambiar
      // (otro supervisor lo asignó, o lo cerraron). El agregado vuelve a validar.
      const locked = await this.tickets.findByIdForUpdate(command.ticketId, manager);
      if (!locked) throw new EntityNotFoundError('Ticket', command.ticketId);

      // Idempotencia: asignar a quien ya está asignado es un no-op, no un evento
      // nuevo. Sin esto, cinco clics en "asignar" generaban cinco avisos al mismo
      // agente — el índice único de notificaciones no protege, porque cada evento
      // trae un eventId distinto (cubre la reentrega del transporte, no la
      // repetición de la operación).
      if (locked.assigneeId === candidate.assignee.id) {
        this.logger.debug(
          `Ticket ${locked.code} ya estaba asignado a ${candidate.assignee.email}; no-op`,
        );
        return locked;
      }

      locked.assignTo(candidate.assignee, candidate.strategyName);
      return this.tickets.saveWithManager(locked, manager);
    });

    // Si fue no-op, no hay eventos pendientes y esto no publica nada.
    await this.events.publishFrom(saved);

    const reloaded = (await this.tickets.findById(saved.id)) ?? saved;
    return toTicketSummary(reloaded);
  }

  private async resolveManual(
    assigneeId: string,
  ): Promise<{ assignee: User; strategyName: string }> {
    const assignee = await this.users.findById(assigneeId);
    if (!assignee) throw new EntityNotFoundError('Agente', assigneeId);
    return { assignee, strategyName: 'manual' };
  }

  private async resolveAutomatic(
    ticket: Ticket,
  ): Promise<{ assignee: User; strategyName: string }> {
    const agents = await this.users.findAgents();
    if (agents.length === 0) {
      throw new BusinessRuleViolationError(
        'No hay agentes disponibles; el ticket queda en la cola sin asignar',
        { ticketId: ticket.id },
      );
    }

    const candidates = await this.buildWorkloads(agents);

    const { result, strategyName } = await this.resolver.assign({
      ticket,
      candidates,
      category: ticket.category,
      priority: ticket.priority,
    });

    return { assignee: result.assignee, strategyName };
  }

  /**
   * Combina los agentes con su carga actual. El conteo se hace en una sola
   * consulta agregada, no una por agente.
   */
  private async buildWorkloads(agents: User[]): Promise<AgentWorkload[]> {
    const counts = await this.tickets.countWorkloadByAgents(agents.map((a) => a.id));
    const byId = new Map(counts.map((c) => [c.assigneeId, c]));

    return agents.map((agent) => ({
      agent,
      openTickets: byId.get(agent.id)?.activeTickets ?? 0,
      overdueTickets: byId.get(agent.id)?.overdueTickets ?? 0,
    }));
  }
}

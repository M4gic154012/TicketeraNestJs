import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TicketStatus } from '@ticketera/common';
import { Ticket, TicketStatusHistory, TypeOrmBaseRepository } from '@ticketera/database';
import { Specification } from '@ticketera/patterns';
import { OverdueTicketSpec } from '../../domain/specifications';
import { EntityManager, Repository as OrmRepository } from 'typeorm';

export interface AgentTicketCounts {
  assigneeId: string;
  /** Todo lo no terminal, incluyendo lo que espera al cliente. */
  openTickets: number;
  /**
   * Lo que realmente demanda trabajo del agente ahora. Excluye
   * WAITING_CUSTOMER: un agente con 15 tickets parados esperando respuesta del
   * usuario no está saturado, y contarlos como carga lo saca del reparto.
   */
  activeTickets: number;
  overdueTickets: number;
}

/**
 * Repositorio de Tickets.
 *
 * Solo agrega lo que una Specification no puede expresar: la secuencia del
 * código, consultas agregadas y la carga explícita de relaciones. Todo filtrado
 * por atributos pasa por Specification.
 */
@Injectable()
export class TicketsRepository extends TypeOrmBaseRepository<Ticket> {
  constructor(@InjectRepository(Ticket) orm: OrmRepository<Ticket>) {
    super(orm, 'ticket');
  }

  protected get sortableColumns(): string[] {
    return ['createdAt', 'updatedAt', 'priority', 'status', 'slaDueAt', 'code'];
  }

  protected get defaultSortColumn(): string {
    return 'createdAt';
  }

  protected get defaultRelations(): string[] {
    return ['requester', 'assignee'];
  }

  /** Ticket con todo su detalle, para la vista de un ticket individual. */
  async findByIdWithDetail(id: string): Promise<Ticket | null> {
    return this.orm
      .createQueryBuilder('ticket')
      .leftJoinAndSelect('ticket.requester', 'requester')
      .leftJoinAndSelect('ticket.assignee', 'assignee')
      .leftJoinAndSelect('ticket.comments', 'comment')
      .leftJoinAndSelect('comment.author', 'commentAuthor')
      .leftJoinAndSelect('ticket.statusHistory', 'history')
      .where('ticket.id = :id', { id })
      .orderBy('comment.createdAt', 'ASC')
      .addOrderBy('history.changedAt', 'ASC')
      .getOne();
  }

  async findByCode(code: string): Promise<Ticket | null> {
    return this.baseQuery().where('ticket.code = :code', { code }).getOne();
  }

  /**
   * Carga el ticket bloqueando la fila dentro de la transacción en curso.
   *
   * Necesario en asignación y cambio de estado: sin el lock, dos operaciones
   * concurrentes leen el mismo estado y la segunda pisa la decisión de la
   * primera. El @VersionColumn detecta el conflicto, pero el lock lo evita.
   */
  async findByIdForUpdate(id: string, manager: EntityManager): Promise<Ticket | null> {
    return manager
      .createQueryBuilder(Ticket, 'ticket')
      .setLock('pessimistic_write')
      .where('ticket.id = :id', { id })
      .getOne();
  }

  /**
   * Siguiente valor de la secuencia de códigos.
   *
   * Usa una secuencia de Postgres y no `MAX(code) + 1`: con dos peticiones
   * concurrentes, el MAX devuelve el mismo número a las dos y una revienta
   * contra el índice único.
   */
  async nextTicketSequence(manager?: EntityManager): Promise<number> {
    const runner = manager ?? this.orm.manager;
    const rows = await runner.query<{ nextval: string }[]>(
      "SELECT nextval('ticket_code_seq') AS nextval",
    );
    return Number(rows[0].nextval);
  }

  /**
   * Carga de trabajo por agente, en una sola consulta agregada.
   *
   * Traer los tickets de cada agente y contarlos en Node serían N+1 consultas y
   * miles de filas para obtener dos números.
   */
  async countWorkloadByAgents(
    agentIds: string[],
    manager?: EntityManager,
  ): Promise<AgentTicketCounts[]> {
    if (agentIds.length === 0) return [];

    const builder = manager
      ? manager.createQueryBuilder(Ticket, 'ticket')
      : this.orm.createQueryBuilder('ticket');

    const rows = await builder
      .select('ticket.assigneeId', 'assigneeId')
      .addSelect('COUNT(*)', 'openTickets')
      .addSelect(
        `SUM(CASE WHEN ticket.status <> '${TicketStatus.WAITING_CUSTOMER}' THEN 1 ELSE 0 END)`,
        'activeTickets',
      )
      .addSelect(
        'SUM(CASE WHEN ticket.slaDueAt IS NOT NULL AND ticket.slaDueAt < NOW() THEN 1 ELSE 0 END)',
        'overdueTickets',
      )
      .where('ticket.assigneeId IN (:...agentIds)', { agentIds })
      .andWhere('ticket.status NOT IN (:...terminal)', {
        terminal: [TicketStatus.RESOLVED, TicketStatus.CLOSED],
      })
      .groupBy('ticket.assigneeId')
      .getRawMany<{
        assigneeId: string;
        openTickets: string;
        activeTickets: string;
        overdueTickets: string;
      }>();

    // Un agente sin tickets no aparece en el resultado (no hay filas que agrupar);
    // quien consume debe tratar la ausencia como cero.
    return rows.map((row) => ({
      assigneeId: row.assigneeId,
      openTickets: Number(row.openTickets),
      activeTickets: Number(row.activeTickets ?? 0),
      overdueTickets: Number(row.overdueTickets ?? 0),
    }));
  }

  /**
   * Candidatos del barrido de SLA: vencidos, no terminales y todavía sin marcar.
   *
   * No usa `baseQuery()` a propósito — los joins a `users` no aportan nada al
   * barrido y multiplican el costo de una consulta que corre cada 5 minutos.
   */
  async findOverdueUnmarked(now: Date, limit: number): Promise<Ticket[]> {
    const qb = this.orm.createQueryBuilder('ticket').take(limit).orderBy('ticket.slaDueAt', 'ASC');

    return new OverdueTicketSpec(now, true).applyTo(qb, 'ticket').getMany();
  }

  /** Resumen por estado para el dashboard, agregado en la base. */
  async countByStatus(spec: Specification<Ticket>): Promise<Record<string, number>> {
    const qb = this.orm
      .createQueryBuilder('ticket')
      .select('ticket.status', 'status')
      .addSelect('COUNT(*)', 'total')
      .groupBy('ticket.status');

    const rows = await spec
      .applyTo(qb as never, 'ticket')
      .getRawMany<{ status: string; total: string }>();

    return Object.fromEntries(rows.map((r) => [r.status, Number(r.total)]));
  }

  /**
   * Tiempo promedio de resolución en minutos.
   *
   * @param agentId acota la métrica a un agente. Sin esto, el dashboard mostraba
   *   el promedio global etiquetado como si fuera el del agente que lo mira.
   *
   * Usa COALESCE(resolvedAt, closedAt) para coincidir con
   * `Ticket.resolutionMinutes()`: un ticket cerrado sin pasar por RESOLVED cuenta
   * en el dominio, y antes no contaba acá.
   */
  async averageResolutionMinutes(
    sinceDays: number,
    agentId?: string,
  ): Promise<number | null> {
    const qb = this.orm
      .createQueryBuilder('ticket')
      .select(
        'AVG(EXTRACT(EPOCH FROM (COALESCE(ticket.resolvedAt, ticket.closedAt) - ticket.createdAt)) / 60)',
        'avgMinutes',
      )
      .where('COALESCE(ticket.resolvedAt, ticket.closedAt) IS NOT NULL')
      // make_interval es tipado; `(:x || ' days')::interval` depende de la
      // resolución de tipos de un parámetro `unknown`.
      .andWhere(
        'COALESCE(ticket.resolvedAt, ticket.closedAt) >= NOW() - make_interval(days => :sinceDays)',
        { sinceDays },
      );

    if (agentId) qb.andWhere('ticket.assigneeId = :agentId', { agentId });

    const row = await qb.getRawOne<{ avgMinutes: string | null }>();
    return row?.avgMinutes ? Math.round(Number(row.avgMinutes)) : null;
  }

  /**
   * Persiste el ticket y su historial nuevo dentro de la transacción del Unit of
   * Work. El historial se inserta después del ticket porque su FK lo exige, y de
   * forma explícita para no depender del cascade (ver Ticket.pullNewStatusHistory).
   */
  async saveWithManager(ticket: Ticket, manager: EntityManager): Promise<Ticket> {
    const pendingHistory = ticket.pullNewStatusHistory();
    const saved = await manager.save(Ticket, ticket);

    if (pendingHistory.length > 0) {
      await manager.insert(
        TicketStatusHistory,
        pendingHistory.map((entry) => ({ ...entry, ticketId: saved.id })),
      );
    }

    return saved;
  }
}

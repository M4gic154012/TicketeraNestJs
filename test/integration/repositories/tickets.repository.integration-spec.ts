import { TicketStatus, UserRole } from '@ticketera/common';
import { Ticket } from '@ticketera/database';
import { AllTicketsSpec } from '../../../apps/tickets-service/src/domain/specifications';
import { TicketTextSearchSpec } from '../../../apps/tickets-service/src/domain/specifications/ticket.specifications';
import { TicketsRepository } from '../../../apps/tickets-service/src/infrastructure/repositories/tickets.repository';
import { createTicket, createUser } from '../support/fixtures';
import { integrationDataSource } from '../support/data-source';
import { resetDatabase } from '../support/reset-database';

/**
 * Consultas agregadas y de agregación de `TicketsRepository` contra Postgres
 * real. Complementa a `ticket.specifications.integration-spec.ts`: acá se
 * cubre lo que una Specification no puede expresar (agregaciones, y el uso
 * real de los índices GIN/parciales/funcionales que CLAUDE.md documenta como
 * imposibles de generar con `migration:generate`).
 */
describe('TicketsRepository (Postgres real)', () => {
  let repository: TicketsRepository;
  let requesterId: string;

  beforeAll(async () => {
    await integrationDataSource.initialize();
    repository = new TicketsRepository(integrationDataSource.getRepository(Ticket));
  });

  afterAll(async () => {
    await integrationDataSource.destroy();
  });

  beforeEach(async () => {
    await resetDatabase(integrationDataSource);
    const requester = await createUser(integrationDataSource, { role: UserRole.REQUESTER });
    requesterId = requester.id;
  });

  describe('averageResolutionMinutes', () => {
    it('promedia usando COALESCE(resolvedAt, closedAt), igual que Ticket.resolutionMinutes()', async () => {
      const createdAt = new Date(Date.now() - 120 * 60_000); // hace 2 horas

      // Resuelto por RESOLVED: 60 minutos de resolución.
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.RESOLVED,
        resolvedAt: new Date(createdAt.getTime() + 60 * 60_000),
      });
      // Cerrado directo sin pasar por RESOLVED: 90 minutos. Antes de la
      // corrección documentada en CLAUDE.md, este caso no contaba en la métrica.
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.CLOSED,
        closedAt: new Date(createdAt.getTime() + 90 * 60_000),
      });
      // Todavía abierto: no debe entrar en el promedio.
      await createTicket(integrationDataSource, requesterId, { status: TicketStatus.OPEN });

      const overrideCreatedAt = async (title: string, createdAtValue: Date) => {
        await integrationDataSource
          .getRepository(Ticket)
          .createQueryBuilder()
          .update(Ticket)
          .set({ createdAt: createdAtValue })
          .where('title = :title', { title })
          .execute();
      };
      // `createdAt` es `@CreateDateColumn`: se pisa después del insert para
      // poder controlar la duración exacta de la resolución en el test.
      await overrideCreatedAt('Ticket de prueba', createdAt);

      const average = await repository.averageResolutionMinutes(30);

      expect(average).toBe(75); // (60 + 90) / 2
    });

    it('excluye tickets resueltos fuera de la ventana de días pedida', async () => {
      const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60_000); // hace 60 días
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.RESOLVED,
        resolvedAt: longAgo,
      });

      const average = await repository.averageResolutionMinutes(30);

      expect(average).toBeNull();
    });

    it('usa el índice parcial ix_tickets_resolution, no un Seq Scan', async () => {
      // El predicado del índice (`WHERE COALESCE(resolvedAt, closedAt) IS NOT
      // NULL`) tiene que calzar exacto con el de la consulta — CLAUDE.md
      // documenta un caso real donde no calzaban y Postgres no podía usarlo.
      // `enable_seqscan=off` distingue "el planner no quiere" de "el planner
      // no puede": si igual aparece Seq Scan acá, es que no puede.
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.RESOLVED,
        resolvedAt: new Date(),
      });

      await integrationDataSource.query('SET enable_seqscan = off');
      try {
        const [plan] = await integrationDataSource.query(
          `EXPLAIN SELECT AVG(EXTRACT(EPOCH FROM (COALESCE("resolvedAt", "closedAt") - "createdAt")) / 60)
           FROM "tickets"
           WHERE COALESCE("resolvedAt", "closedAt") IS NOT NULL
             AND COALESCE("resolvedAt", "closedAt") >= NOW() - make_interval(days => 30)`,
        );
        const planText = JSON.stringify(plan);
        expect(planText).not.toContain('Seq Scan');
      } finally {
        await integrationDataSource.query('SET enable_seqscan = on');
      }
    });
  });

  describe('findOverdueUnmarked', () => {
    it('trae solo los no terminales, vencidos y sin marcar, ordenados por vencimiento', async () => {
      const later = await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.OPEN,
        slaDueAt: new Date(Date.now() - 60_000),
      });
      const earlier = await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.IN_PROGRESS,
        slaDueAt: new Date(Date.now() - 120_000),
      });
      // Ya marcado: no debe volver a aparecer en el barrido.
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.OPEN,
        slaDueAt: new Date(Date.now() - 60_000),
        slaBreached: true,
      });
      // Terminal: aunque esté "vencido" por fecha, ya no consume SLA.
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.RESOLVED,
        slaDueAt: new Date(Date.now() - 60_000),
        resolvedAt: new Date(),
      });

      const result = await repository.findOverdueUnmarked(new Date(), 10);

      expect(result.map((t) => t.id)).toEqual([earlier.id, later.id]);
    });
  });

  it('countByStatus agrupa correctamente, combinado con una Specification', async () => {
    await createTicket(integrationDataSource, requesterId, { status: TicketStatus.OPEN });
    await createTicket(integrationDataSource, requesterId, { status: TicketStatus.OPEN });
    await createTicket(integrationDataSource, requesterId, { status: TicketStatus.CLOSED });

    const counts = await repository.countByStatus(new AllTicketsSpec());

    expect(counts[TicketStatus.OPEN]).toBe(2);
    expect(counts[TicketStatus.CLOSED]).toBe(1);
  });

  describe('findPaged', () => {
    it('un orderBy fuera de la whitelist cae al default en vez de romper o inyectarse', async () => {
      await createTicket(integrationDataSource, requesterId, {});

      // `sortableColumns` no incluye "id"; si el repositorio interpolara esto
      // directo en ORDER BY sin la whitelist, esto sería inyección SQL.
      const page = await repository.findPaged(new AllTicketsSpec(), {
        page: 1,
        pageSize: 10,
        orderBy: 'id; DROP TABLE tickets; --',
      } as never);

      expect(page.total).toBe(1);
    });
  });

  it('la búsqueda de texto usa los índices trgm, no un Seq Scan', async () => {
    // Un OR de ILIKE necesita que TODAS las ramas sean indexables para armar un
    // BitmapOr (CLAUDE.md): faltaba el trgm de description en algún momento y
    // el índice de title no se usaba nunca. `EXPLAIN` sobre la consulta REAL
    // que arma la Specification (no una copia a mano) es lo único que
    // distingue "el planner no quiere" de "el planner no puede".
    const qb = integrationDataSource.getRepository(Ticket).createQueryBuilder('ticket');
    const [sql, params] = new TicketTextSearchSpec('prueba').applyTo(qb, 'ticket').getQueryAndParameters();

    await integrationDataSource.query('SET enable_seqscan = off');
    try {
      const plan = await integrationDataSource.query(`EXPLAIN ${sql}`, params);
      const planText = JSON.stringify(plan);
      expect(planText).not.toContain('Seq Scan');
    } finally {
      await integrationDataSource.query('SET enable_seqscan = on');
    }
  });
});

import { TicketStatus, UserRole } from '@ticketera/common';
import { Ticket } from '@ticketera/database';
import { Specification } from '@ticketera/patterns';
import {
  OverdueTicketSpec,
  TicketAssignedToSpec,
  TicketByStatusSpec,
  TicketCreatedBetweenSpec,
  TicketTextSearchSpec,
  UnassignedTicketSpec,
} from '../../../apps/tickets-service/src/domain/specifications/ticket.specifications';
import { createTicket, createUser } from '../support/fixtures';
import { integrationDataSource } from '../support/data-source';
import { resetDatabase } from '../support/reset-database';

/**
 * `applyTo` es la mitad de cada Specification que `ticket.specifications.spec.ts`
 * (el test unitario) declara explícitamente fuera de su alcance: "la traducción
 * a SQL se cubre en los tests de integración del repositorio". Hasta este
 * archivo, esos tests no existían — la mitad que corre en producción quedaba
 * sin cubrir. Ver CLAUDE.md, sección QA.
 */
describe('Ticket specifications — applyTo (Postgres real)', () => {
  let requesterId: string;

  beforeAll(async () => {
    await integrationDataSource.initialize();
  });

  afterAll(async () => {
    await integrationDataSource.destroy();
  });

  beforeEach(async () => {
    await resetDatabase(integrationDataSource);
    const requester = await createUser(integrationDataSource, { role: UserRole.REQUESTER });
    requesterId = requester.id;
  });

  const findAll = async (spec: Specification<Ticket>): Promise<Ticket[]> => {
    const qb = integrationDataSource.getRepository(Ticket).createQueryBuilder('ticket');
    return spec.applyTo(qb, 'ticket').getMany();
  };

  it('TicketByStatusSpec devuelve solo los estados pedidos', async () => {
    const open = await createTicket(integrationDataSource, requesterId, {
      status: TicketStatus.OPEN,
    });
    await createTicket(integrationDataSource, requesterId, { status: TicketStatus.CLOSED });

    const result = await findAll(new TicketByStatusSpec([TicketStatus.OPEN]));

    expect(result.map((t) => t.id)).toEqual([open.id]);
  });

  it('TicketAssignedToSpec filtra por assigneeId exacto', async () => {
    const agent = await createUser(integrationDataSource, { role: UserRole.AGENT });
    const otherAgent = await createUser(integrationDataSource, { role: UserRole.AGENT });
    const assigned = await createTicket(integrationDataSource, requesterId, {
      assigneeId: agent.id,
    });
    await createTicket(integrationDataSource, requesterId, { assigneeId: otherAgent.id });

    const result = await findAll(new TicketAssignedToSpec(agent.id));

    expect(result.map((t) => t.id)).toEqual([assigned.id]);
  });

  it('UnassignedTicketSpec trae solo los que tienen assigneeId NULL', async () => {
    const agent = await createUser(integrationDataSource, { role: UserRole.AGENT });
    const unassigned = await createTicket(integrationDataSource, requesterId, {
      assigneeId: null,
    });
    await createTicket(integrationDataSource, requesterId, { assigneeId: agent.id });

    const result = await findAll(new UnassignedTicketSpec());

    expect(result.map((t) => t.id)).toEqual([unassigned.id]);
  });

  describe('OverdueTicketSpec', () => {
    it('incluye un ticket no terminal con SLA vencido', async () => {
      const overdue = await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.IN_PROGRESS,
        slaDueAt: new Date(Date.now() - 60_000),
      });

      const result = await findAll(new OverdueTicketSpec(new Date()));

      expect(result.map((t) => t.id)).toEqual([overdue.id]);
    });

    it('excluye un ticket RESOLVED aunque su SLA ya haya vencido', async () => {
      // Regresión directa: la Specification excluye RESOLVED/CLOSED por SQL, no
      // solo en `isSatisfiedBy` — sin esto un ticket resuelto tarde seguía
      // apareciendo como vencido para siempre en la bandeja de "atrasados".
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.RESOLVED,
        slaDueAt: new Date(Date.now() - 60_000),
        resolvedAt: new Date(),
      });

      const result = await findAll(new OverdueTicketSpec(new Date()));

      expect(result).toHaveLength(0);
    });

    it('excluye un ticket cuyo SLA todavía no vence', async () => {
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.OPEN,
        slaDueAt: new Date(Date.now() + 60_000),
      });

      const result = await findAll(new OverdueTicketSpec(new Date()));

      expect(result).toHaveLength(0);
    });

    it('con onlyUnmarked, excluye los que ya tienen el incumplimiento registrado', async () => {
      await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.OPEN,
        slaDueAt: new Date(Date.now() - 60_000),
        slaBreached: true,
      });
      const stillNew = await createTicket(integrationDataSource, requesterId, {
        status: TicketStatus.OPEN,
        slaDueAt: new Date(Date.now() - 60_000),
        slaBreached: false,
      });

      const result = await findAll(new OverdueTicketSpec(new Date(), true));

      expect(result.map((t) => t.id)).toEqual([stillNew.id]);
    });
  });

  describe('TicketTextSearchSpec', () => {
    it('encuentra por coincidencia parcial en el título', async () => {
      const match = await createTicket(integrationDataSource, requesterId, {
        title: 'El correo institucional dejó de sincronizar',
      });
      await createTicket(integrationDataSource, requesterId, { title: 'Otro problema distinto' });

      const result = await findAll(new TicketTextSearchSpec('sincronizar'));

      expect(result.map((t) => t.id)).toEqual([match.id]);
    });

    it('escapa "%" en el término: no lo trata como comodín de ILIKE', async () => {
      // Regresión de QA: "buscar '%' devolvía la tabla entera" porque el
      // comodín del usuario viajaba sin escapar hasta el ILIKE. No es una
      // vulnerabilidad (el valor va parametrizado) pero sí un resultado
      // incorrecto — y hasta este test, nada lo verificaba contra SQL real.
      const withPercent = await createTicket(integrationDataSource, requesterId, {
        title: 'Avance al 100% del ticket',
      });
      await createTicket(integrationDataSource, requesterId, { title: 'Ticket sin el símbolo' });
      await createTicket(integrationDataSource, requesterId, { title: 'Otro ticket cualquiera' });

      const result = await findAll(new TicketTextSearchSpec('%'));

      expect(result.map((t) => t.id)).toEqual([withPercent.id]);
    });

    it('escapa "_" en el término: no lo trata como comodín de un solo caracter', async () => {
      const withUnderscore = await createTicket(integrationDataSource, requesterId, {
        title: 'codigo_de_prueba',
      });
      await createTicket(integrationDataSource, requesterId, { title: 'codigoXdeXprueba' });

      const result = await findAll(new TicketTextSearchSpec('codigo_de'));

      expect(result.map((t) => t.id)).toEqual([withUnderscore.id]);
    });
  });

  describe('TicketCreatedBetweenSpec', () => {
    it('con solo "from", acota el rango en vez de devolver la tabla entera', async () => {
      // Mismo bug que ya cubre la suite E2E a nivel HTTP; acá se fija a nivel
      // de Specification, más barato de correr y más fácil de ubicar si falla.
      await createTicket(integrationDataSource, requesterId, {});

      const result = await findAll(
        new TicketCreatedBetweenSpec(new Date('2099-01-01T00:00:00.000Z'), undefined),
      );

      expect(result).toHaveLength(0);
    });

    it('con ambos extremos, incluye los límites', async () => {
      // `createdAt` se fija a mano (no se deja generar por el DEFAULT de
      // Postgres): `now()` en el servidor tiene precisión de microsegundos, y
      // el driver lee un JS Date truncado a milisegundos — comparar ese valor
      // truncado contra la fila real con `<=` falla por los microsegundos que
      // el Date nunca pudo representar. Fijándolo nosotros, escritura y
      // lectura usan exactamente el mismo valor.
      const createdAt = new Date('2026-01-01T12:00:00.000Z');
      const ticket = await createTicket(integrationDataSource, requesterId, { createdAt });

      const result = await findAll(new TicketCreatedBetweenSpec(createdAt, createdAt));

      expect(result.map((t) => t.id)).toEqual([ticket.id]);
    });
  });

  it('dos Specifications combinadas con `.and()` traducen a un único WHERE', async () => {
    const agent = await createUser(integrationDataSource, { role: UserRole.AGENT });
    const otherAgent = await createUser(integrationDataSource, { role: UserRole.AGENT });
    const match = await createTicket(integrationDataSource, requesterId, {
      status: TicketStatus.ASSIGNED,
      assigneeId: agent.id,
    });
    // Mismo estado, otro agente: si el AND se tradujera como OR, esto también
    // aparecería en el resultado.
    await createTicket(integrationDataSource, requesterId, {
      status: TicketStatus.ASSIGNED,
      assigneeId: otherAgent.id,
    });
    // Mismo agente, otro estado: idem, del otro lado del AND.
    await createTicket(integrationDataSource, requesterId, {
      status: TicketStatus.OPEN,
      assigneeId: agent.id,
    });

    const spec = new TicketAssignedToSpec(agent.id).and(
      new TicketByStatusSpec([TicketStatus.ASSIGNED]),
    );
    const result = await findAll(spec);

    expect(result.map((t) => t.id)).toEqual([match.id]);
  });
});

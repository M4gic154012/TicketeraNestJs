import { TicketCategory, TicketPriority, TicketStatus } from '@ticketera/common';
import { Ticket } from '@ticketera/database';
import { randomUUID } from 'node:crypto';
import {
  AgentWorkQueueSpec,
  OverdueTicketSpec,
  TicketAssignedToSpec,
  TicketByPrioritySpec,
  TicketByStatusSpec,
  TicketByTagSpec,
  TicketNearSlaBreachSpec,
  TicketTextSearchSpec,
  UnassignedTicketSpec,
} from './ticket.specifications';

/**
 * Se verifica el lado `isSatisfiedBy`, que es el que permite testear reglas de
 * consulta sin base de datos. La traducción a SQL se cubre en los tests de
 * integración del repositorio.
 */
describe('Specifications de Ticket', () => {
  const build = (overrides: Partial<Ticket> = {}): Ticket => {
    const ticket = new Ticket();
    ticket.id = randomUUID();
    ticket.code = 'TCK-000007';
    ticket.title = 'Sin acceso a la VPN';
    ticket.description = 'La VPN rechaza mis credenciales desde el lunes';
    ticket.status = TicketStatus.OPEN;
    ticket.priority = TicketPriority.MEDIUM;
    ticket.category = TicketCategory.NETWORK;
    ticket.requesterId = randomUUID();
    ticket.assigneeId = null;
    ticket.slaDueAt = null;
    ticket.tags = ['vpn'];
    ticket.createdAt = new Date('2026-01-01T10:00:00Z');
    return Object.assign(ticket, overrides);
  };

  it('filtra por estado', () => {
    const spec = new TicketByStatusSpec([TicketStatus.OPEN, TicketStatus.ASSIGNED]);

    expect(spec.isSatisfiedBy(build({ status: TicketStatus.OPEN }))).toBe(true);
    expect(spec.isSatisfiedBy(build({ status: TicketStatus.CLOSED }))).toBe(false);
  });

  it('detecta tickets sin asignar', () => {
    const spec = new UnassignedTicketSpec();

    expect(spec.isSatisfiedBy(build())).toBe(true);
    expect(spec.isSatisfiedBy(build({ assigneeId: randomUUID() }))).toBe(false);
  });

  it('busca texto en código, título y descripción', () => {
    const spec = new TicketTextSearchSpec('VPN');

    expect(spec.isSatisfiedBy(build())).toBe(true);
    expect(new TicketTextSearchSpec('tck-000007').isSatisfiedBy(build())).toBe(true);
    expect(new TicketTextSearchSpec('impresora').isSatisfiedBy(build())).toBe(false);
  });

  describe('composición', () => {
    it('and exige que se cumplan ambas', () => {
      const spec = new TicketByStatusSpec([TicketStatus.OPEN]).and(
        new TicketByPrioritySpec([TicketPriority.CRITICAL]),
      );

      expect(spec.isSatisfiedBy(build({ priority: TicketPriority.CRITICAL }))).toBe(true);
      expect(spec.isSatisfiedBy(build({ priority: TicketPriority.LOW }))).toBe(false);
    });

    it('or alcanza con una', () => {
      const spec = new TicketByPrioritySpec([TicketPriority.CRITICAL]).or(
        new TicketByTagSpec('vpn'),
      );

      expect(spec.isSatisfiedBy(build({ priority: TicketPriority.LOW }))).toBe(true);
    });

    it('not invierte el resultado', () => {
      const spec = new UnassignedTicketSpec().not();

      expect(spec.isSatisfiedBy(build())).toBe(false);
      expect(spec.isSatisfiedBy(build({ assigneeId: randomUUID() }))).toBe(true);
    });
  });

  describe('SLA', () => {
    const now = new Date('2026-01-05T12:00:00Z');

    it('vencido solo si pasó la fecha y no está en estado terminal', () => {
      const spec = new OverdueTicketSpec(now);
      const due = new Date('2026-01-05T10:00:00Z');

      expect(spec.isSatisfiedBy(build({ slaDueAt: due }))).toBe(true);
      expect(spec.isSatisfiedBy(build({ slaDueAt: due, status: TicketStatus.RESOLVED }))).toBe(
        false,
      );
      expect(
        spec.isSatisfiedBy(build({ slaDueAt: new Date('2026-01-06T00:00:00Z') })),
      ).toBe(false);
    });

    it('vencimiento inminente excluye lo ya vencido', () => {
      const spec = new TicketNearSlaBreachSpec(60, now);

      expect(spec.isSatisfiedBy(build({ slaDueAt: new Date('2026-01-05T12:30:00Z') }))).toBe(
        true,
      );
      expect(spec.isSatisfiedBy(build({ slaDueAt: new Date('2026-01-05T11:00:00Z') }))).toBe(
        false,
      );
      expect(spec.isSatisfiedBy(build({ slaDueAt: new Date('2026-01-05T14:00:00Z') }))).toBe(
        false,
      );
    });
  });

  describe('AgentWorkQueueSpec', () => {
    const agentId = randomUUID();

    it('incluye lo asignado que aún exige acción', () => {
      const spec = new AgentWorkQueueSpec(agentId);

      expect(
        spec.isSatisfiedBy(build({ assigneeId: agentId, status: TicketStatus.IN_PROGRESS })),
      ).toBe(true);
      expect(
        spec.isSatisfiedBy(build({ assigneeId: agentId, status: TicketStatus.RESOLVED })),
      ).toBe(false);
      expect(
        spec.isSatisfiedBy(build({ assigneeId: randomUUID(), status: TicketStatus.ASSIGNED })),
      ).toBe(false);
    });

    it('excluye lo que todavía está sin asignar', () => {
      expect(
        new AgentWorkQueueSpec(agentId).isSatisfiedBy(build({ status: TicketStatus.OPEN })),
      ).toBe(false);
    });
  });

  it('TicketAssignedToSpec compara por id de agente', () => {
    const agentId = randomUUID();

    expect(new TicketAssignedToSpec(agentId).isSatisfiedBy(build({ assigneeId: agentId }))).toBe(
      true,
    );
  });
});

import {
  BusinessRuleViolationError,
  InvalidStateTransitionError,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@ticketera/common';
import { randomUUID } from 'node:crypto';
import { Ticket } from './ticket.entity';
import { TicketComment } from './ticket-comment.entity';
import { User } from './user.entity';

/**
 * Tests del agregado. No tocan la base: la razón de poner las reglas en la
 * entidad es justamente poder verificarlas sin infraestructura.
 */
describe('Ticket (agregado)', () => {
  const buildAgent = (overrides: Partial<User> = {}): User => {
    const agent = new User();
    agent.id = randomUUID();
    agent.email = 'agente@test.local';
    agent.fullName = 'Agente Test';
    agent.role = UserRole.AGENT;
    agent.isActive = true;
    agent.skills = ['NETWORK'];
    agent.maxConcurrentTickets = 10;
    return Object.assign(agent, overrides);
  };

  const buildTicket = (overrides: Partial<Ticket> = {}): Ticket => {
    const ticket = new Ticket();
    ticket.id = randomUUID();
    ticket.code = 'TCK-000001';
    ticket.title = 'Sin conexión';
    ticket.description = 'No hay red en el piso 3';
    ticket.status = TicketStatus.OPEN;
    ticket.priority = TicketPriority.MEDIUM;
    ticket.requesterId = randomUUID();
    ticket.assigneeId = null;
    ticket.slaDueAt = null;
    ticket.slaBreached = false;
    ticket.firstResponseAt = null;
    ticket.resolvedAt = null;
    ticket.closedAt = null;
    ticket.tags = [];
    ticket.createdAt = new Date('2026-01-01T10:00:00Z');
    return Object.assign(ticket, overrides);
  };

  describe('assignTo', () => {
    it('asigna y mueve OPEN a ASSIGNED', () => {
      const ticket = buildTicket();
      const agent = buildAgent();

      ticket.assignTo(agent, 'skill-based');

      expect(ticket.assigneeId).toBe(agent.id);
      expect(ticket.status).toBe(TicketStatus.ASSIGNED);
      expect(ticket.pullNewStatusHistory()).toHaveLength(1);
    });

    it('registra el evento con la estrategia que decidió', () => {
      const ticket = buildTicket();
      ticket.assignTo(buildAgent(), 'escalation');

      const events = ticket.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe('ticket.assigned');
      expect(events[0].payload()).toMatchObject({ assignedByStrategy: 'escalation' });
    });

    it('rechaza asignar un ticket cerrado', () => {
      const ticket = buildTicket({ status: TicketStatus.CLOSED });

      expect(() => ticket.assignTo(buildAgent(), 'manual')).toThrow(BusinessRuleViolationError);
    });

    it('rechaza asignar a un solicitante', () => {
      const ticket = buildTicket();
      const requester = buildAgent({ role: UserRole.REQUESTER });

      expect(() => ticket.assignTo(requester, 'manual')).toThrow(/Solo un agente/);
    });

    it('rechaza asignar a un agente inactivo', () => {
      const ticket = buildTicket();

      expect(() => ticket.assignTo(buildAgent({ isActive: false }), 'manual')).toThrow(
        /inactivo/,
      );
    });

    it('no cambia el estado si el ticket ya estaba en progreso', () => {
      const ticket = buildTicket({
        status: TicketStatus.IN_PROGRESS,
        assigneeId: randomUUID(),
      });

      ticket.assignTo(buildAgent(), 'manual');

      expect(ticket.status).toBe(TicketStatus.IN_PROGRESS);
    });
  });

  describe('changeStatus', () => {
    it('rechaza una transición no permitida', () => {
      const ticket = buildTicket({ status: TicketStatus.OPEN });

      expect(() => ticket.changeStatus(TicketStatus.RESOLVED, randomUUID())).toThrow(
        InvalidStateTransitionError,
      );
    });

    it('exige agente asignado para pasar a IN_PROGRESS', () => {
      const ticket = buildTicket({ status: TicketStatus.ASSIGNED, assigneeId: null });

      expect(() => ticket.changeStatus(TicketStatus.IN_PROGRESS, randomUUID())).toThrow(
        /sin agente asignado/,
      );
    });

    it('un ticket CLOSED no admite ninguna transición', () => {
      const ticket = buildTicket({ status: TicketStatus.CLOSED });

      for (const status of Object.values(TicketStatus)) {
        expect(() => ticket.changeStatus(status, randomUUID())).toThrow(
          InvalidStateTransitionError,
        );
      }
    });

    it('al resolver emite también el evento de resolución', () => {
      const ticket = buildTicket({
        status: TicketStatus.IN_PROGRESS,
        assigneeId: randomUUID(),
      });

      ticket.changeStatus(TicketStatus.RESOLVED, randomUUID(), 'listo');

      const names = ticket.pullDomainEvents().map((e) => e.eventName);
      expect(names).toEqual(['ticket.status-changed', 'ticket.resolved']);
      expect(ticket.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('addComment', () => {
    const buildComment = (overrides: Partial<TicketComment> = {}): TicketComment => {
      const comment = new TicketComment();
      comment.id = randomUUID();
      comment.authorId = randomUUID();
      comment.body = 'Ya lo estoy revisando';
      comment.isInternal = false;
      comment.createdAt = new Date();
      return Object.assign(comment, overrides);
    };

    it('marca la primera respuesta cuando comenta alguien distinto del solicitante', () => {
      const ticket = buildTicket();

      ticket.addComment(buildComment());

      expect(ticket.firstResponseAt).toBeInstanceOf(Date);
    });

    it('no marca primera respuesta si comenta el propio solicitante', () => {
      const ticket = buildTicket();

      ticket.addComment(buildComment({ authorId: ticket.requesterId }));

      expect(ticket.firstResponseAt).toBeNull();
    });

    it('una nota interna no cuenta como primera respuesta', () => {
      const ticket = buildTicket();

      ticket.addComment(buildComment({ isInternal: true }));

      expect(ticket.firstResponseAt).toBeNull();
    });

    it('rechaza comentar un ticket cerrado', () => {
      const ticket = buildTicket({ status: TicketStatus.CLOSED });

      expect(() => ticket.addComment(buildComment())).toThrow(/cerrado/);
    });
  });

  describe('SLA', () => {
    it('marca el incumplimiento una sola vez', () => {
      const ticket = buildTicket({ slaDueAt: new Date('2026-01-01T12:00:00Z') });
      const now = new Date('2026-01-01T13:30:00Z');

      ticket.markSlaBreached(now);
      const firstEvents = ticket.pullDomainEvents();

      ticket.markSlaBreached(now);
      const secondEvents = ticket.pullDomainEvents();

      expect(firstEvents).toHaveLength(1);
      expect(firstEvents[0].payload()).toMatchObject({ minutesOverdue: 90 });
      expect(secondEvents).toHaveLength(0);
    });

    it('no marca incumplimiento en un ticket ya resuelto', () => {
      const ticket = buildTicket({
        status: TicketStatus.RESOLVED,
        slaDueAt: new Date('2026-01-01T12:00:00Z'),
      });

      ticket.markSlaBreached(new Date('2026-01-02T00:00:00Z'));

      expect(ticket.slaBreached).toBe(false);
      expect(ticket.pullDomainEvents()).toHaveLength(0);
    });

    it('isOverdue ignora los estados terminales', () => {
      const due = new Date('2026-01-01T12:00:00Z');
      const now = new Date('2026-01-02T00:00:00Z');

      expect(buildTicket({ slaDueAt: due }).isOverdue(now)).toBe(true);
      expect(buildTicket({ slaDueAt: due, status: TicketStatus.CLOSED }).isOverdue(now)).toBe(
        false,
      );
    });
  });
});

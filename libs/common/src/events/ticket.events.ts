import { DomainEvent } from '@ticketera/patterns';
import { TicketCategory, TicketPriority, TicketStatus } from '../contracts/enums';

/**
 * Eventos de dominio de tickets. Viven en `common` porque son el contrato entre
 * quien los emite (tickets-service) y quien los observa (notifications-service,
 * auditoría): si vivieran dentro de un app, el consumidor no podría tiparlos.
 */

export class TicketCreatedEvent extends DomainEvent {
  readonly eventName = 'ticket.created';

  constructor(
    readonly aggregateId: string,
    private readonly data: {
      code: string;
      title: string;
      requesterId: string;
      priority: TicketPriority;
      category: TicketCategory;
      slaDueAt: string | null;
    },
  ) {
    super();
  }

  payload(): Record<string, unknown> {
    return { ticketId: this.aggregateId, ...this.data };
  }
}

export class TicketAssignedEvent extends DomainEvent {
  readonly eventName = 'ticket.assigned';

  constructor(
    readonly aggregateId: string,
    private readonly data: {
      code: string;
      assigneeId: string;
      previousAssigneeId: string | null;
      assignedByStrategy: string;
    },
  ) {
    super();
  }

  payload(): Record<string, unknown> {
    return { ticketId: this.aggregateId, ...this.data };
  }
}

export class TicketStatusChangedEvent extends DomainEvent {
  readonly eventName = 'ticket.status-changed';

  constructor(
    readonly aggregateId: string,
    // requesterId y assigneeId viajan en el evento porque quien decide a quién
    // notificar es el consumidor, y sin ellos tenía que adivinar: terminaba
    // avisándole a quien hizo el cambio en lugar de a quien espera el ticket.
    private readonly data: {
      code: string;
      fromStatus: TicketStatus;
      toStatus: TicketStatus;
      changedById: string;
      requesterId: string;
      assigneeId: string | null;
      reason: string | null;
    },
  ) {
    super();
  }

  payload(): Record<string, unknown> {
    return { ticketId: this.aggregateId, ...this.data };
  }
}

export class TicketCommentedEvent extends DomainEvent {
  readonly eventName = 'ticket.commented';

  constructor(
    readonly aggregateId: string,
    private readonly data: {
      code: string;
      commentId: string;
      authorId: string;
      isInternal: boolean;
      excerpt: string;
      requesterId: string;
      assigneeId: string | null;
    },
  ) {
    super();
  }

  payload(): Record<string, unknown> {
    return { ticketId: this.aggregateId, ...this.data };
  }
}

export class TicketSlaBreachedEvent extends DomainEvent {
  readonly eventName = 'ticket.sla-breached';

  constructor(
    readonly aggregateId: string,
    private readonly data: {
      code: string;
      assigneeId: string | null;
      slaDueAt: string;
      minutesOverdue: number;
    },
  ) {
    super();
  }

  payload(): Record<string, unknown> {
    return { ticketId: this.aggregateId, ...this.data };
  }
}

export class TicketResolvedEvent extends DomainEvent {
  readonly eventName = 'ticket.resolved';

  constructor(
    readonly aggregateId: string,
    private readonly data: {
      code: string;
      requesterId: string;
      resolvedById: string;
      resolutionMinutes: number;
      withinSla: boolean;
    },
  ) {
    super();
  }

  payload(): Record<string, unknown> {
    return { ticketId: this.aggregateId, ...this.data };
  }
}

/** Nombres de evento, para registrar observadores sin repetir strings. */
export const TICKET_EVENTS = {
  created: 'ticket.created',
  assigned: 'ticket.assigned',
  statusChanged: 'ticket.status-changed',
  commented: 'ticket.commented',
  slaBreached: 'ticket.sla-breached',
  resolved: 'ticket.resolved',
} as const;

import { Injectable } from '@nestjs/common';
import {
  NOTIFICATIONS_PATTERNS,
  TICKETS_PATTERNS,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@ticketera/common';
import { ServiceClients } from '../clients/service.clients';

export interface AgentDashboardRequest {
  agentId: string;
  /** Rol del actor: un supervisor ve además la cola general sin dueño. */
  agentRole?: UserRole;
}

/**
 * Composer del tablero del agente: su cola, los vencidos, las urgencias sin
 * dueño, sus métricas y su bandeja.
 *
 * Las cinco consultas salen en paralelo. En serie, la pantalla tardaría la suma
 * de todas; en paralelo, tarda la más lenta.
 */
@Injectable()
export class AgentDashboardComposer {
  constructor(private readonly services: ServiceClients) {}

  async compose(request: AgentDashboardRequest) {
    const emptyPage = () => ({ items: [], total: 0, page: 1, pageSize: 0, totalPages: 1 });

    const [myQueue, overdue, unassignedUrgent, unassignedOverdue, stats, notifications] =
      await Promise.all([
      this.services.tickets(TICKETS_PATTERNS.search, {
        assigneeId: request.agentId,
        statuses: [TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CUSTOMER],
        page: 1,
        pageSize: 20,
        orderBy: 'slaDueAt',
        order: 'ASC',
      }),
      this.services.tickets(
        TICKETS_PATTERNS.search,
        { assigneeId: request.agentId, overdueOnly: true, page: 1, pageSize: 10 },
        emptyPage,
      ),
      this.services.tickets(
        TICKETS_PATTERNS.search,
        {
          unassignedOnly: true,
          priorities: [TicketPriority.CRITICAL, TicketPriority.HIGH],
          page: 1,
          pageSize: 10,
        },
        emptyPage,
      ),
      // Vencidos SIN asignar, de cualquier prioridad. Era un punto ciego real: la
      // cola de vencidos está acotada al agente, y las urgencias sin dueño solo
      // miran CRITICAL y HIGH, así que un vencido sin asignar de prioridad MEDIUM o
      // LOW no aparecía en ningún panel ni generaba aviso (el evento de SLA no
      // notifica cuando no hay asignado).
      this.services.tickets(
        TICKETS_PATTERNS.search,
        {
          unassignedOnly: true,
          overdueOnly: true,
          page: 1,
          pageSize: 20,
          orderBy: 'slaDueAt',
          order: 'ASC',
        },
        emptyPage,
      ),
      this.services.tickets(
        TICKETS_PATTERNS.statsByAgent,
        { agentId: request.agentId },
        () => null,
      ),
      this.services.notifications(
        NOTIFICATIONS_PATTERNS.findForUser,
        { recipientId: request.agentId, onlyUnread: true, limit: 10 },
        () => ({ items: [], unreadCount: 0 }),
      ),
    ]);

    return {
      myQueue,
      overdue,
      unassignedUrgent,
      // Solo la supervisión necesita la cola general sin dueño; un agente ve su
      // propio trabajo.
      ...(this.isSupervisor(request.agentRole) ? { unassignedOverdue } : {}),
      stats,
      notifications,
    };
  }

  private isSupervisor(role?: UserRole): boolean {
    return role === UserRole.SUPERVISOR || role === UserRole.ADMIN;
  }
}

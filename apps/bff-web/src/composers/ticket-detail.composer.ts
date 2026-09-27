import { Injectable } from '@nestjs/common';
import {
  TICKETS_PATTERNS,
  TicketStatus,
  UserRole,
  buildTicketPermissions,
} from '@ticketera/common';
import { ServiceClients } from '../clients/service.clients';

export interface TicketDetailRequest {
  ticketId: string;
  viewerId: string;
  viewerRole: UserRole;
}

/**
 * Composer de la pantalla de detalle de ticket.
 *
 * El BFF existe para esto: el frontend pide una vez y recibe todo lo que la
 * pantalla necesita, en vez de encadenar tres llamadas y resolver la latencia
 * acumulada en el navegador.
 */
@Injectable()
export class TicketDetailComposer {
  constructor(private readonly services: ServiceClients) {}

  async compose(request: TicketDetailRequest) {
    // El ticket es el dato esencial: si falla, la pantalla no tiene sentido y el
    // error se propaga.
    const ticket = await this.services.tickets<TicketDetailResponse>(
      TICKETS_PATTERNS.findById,
      request,
    );

    const actor = { id: request.viewerId, role: request.viewerRole };
    const context = {
      requesterId: ticket.requester?.id ?? '',
      assigneeId: ticket.assignee?.id ?? null,
      status: ticket.status,
    };

    // Los permisos se calculan con las MISMAS funciones que usan los casos de uso
    // para autorizar (libs/common/contracts/ticket-permissions). Antes el composer
    // tenía su propia versión simplificada y contradecía la autorización real: le
    // escondía al solicitante el botón de cerrar su ticket (que sí puede) y le
    // ofrecía al agente no asignado acciones que devolvían 403.
    const permissions = buildTicketPermissions(actor, context);

    // Los agentes disponibles son accesorios: degradan a [] si users-service no
    // responde, y solo se piden si el actor realmente puede reasignar.
    const availableAgents = permissions.canReassign
      ? await this.services.users<Record<string, unknown>[]>(
          'users.user.find-many',
          { roles: [UserRole.AGENT, UserRole.SUPERVISOR], isActive: true },
          () => [],
        )
      : [];

    return { ticket, permissions, availableAgents };
  }
}

/** Lo que el composer necesita leer de la respuesta del servicio de tickets. */
export interface TicketDetailResponse {
  status: TicketStatus;
  requester: { id: string } | null;
  assignee: { id: string } | null;
}

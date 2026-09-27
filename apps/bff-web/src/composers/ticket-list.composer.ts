import { Injectable } from '@nestjs/common';
import { TICKETS_PATTERNS, UserRole } from '@ticketera/common';
import { ServiceClients } from '../clients/service.clients';

export interface TicketListRequest {
  viewerId: string;
  viewerRole: UserRole;
  filters: Record<string, unknown>;
}

/**
 * Composer del listado de tickets.
 *
 * Acota el alcance según quién mira: un solicitante solo ve lo suyo. El filtro se
 * fuerza acá y no se toma del cliente, porque un `requesterId` enviado por el
 * navegador es manipulable.
 */
@Injectable()
export class TicketListComposer {
  constructor(private readonly services: ServiceClients) {}

  async compose(request: TicketListRequest) {
    const scoped =
      request.viewerRole === UserRole.REQUESTER
        ? { ...request.filters, requesterId: request.viewerId, assigneeId: undefined }
        : request.filters;

    const page = await this.services.tickets<Record<string, unknown>>(
      TICKETS_PATTERNS.search,
      scoped,
    );

    return {
      ...page,
      appliedScope: request.viewerRole === UserRole.REQUESTER ? 'own-tickets' : 'all-tickets',
    };
  }
}

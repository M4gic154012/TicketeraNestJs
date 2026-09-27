import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { BFF_PATTERNS, TICKETS_PATTERNS } from '@ticketera/common';
import { ServiceClients } from './clients/service.clients';
import {
  AgentDashboardComposer,
  AgentDashboardRequest,
  PrivacyDossierComposer,
  PrivacyDossierRequest,
  TicketDetailComposer,
  TicketDetailRequest,
  TicketListComposer,
  TicketListRequest,
} from './composers';

/**
 * Borde RPC del BFF. El gateway le habla a él; él habla con los microservicios.
 *
 * Las escrituras simples (crear ticket) pasan de largo hacia el servicio dueño:
 * el BFF solo agrega valor cuando hay algo que componer o que adaptar al cliente.
 */
@Controller()
export class BffController {
  constructor(
    private readonly ticketDetail: TicketDetailComposer,
    private readonly dashboard: AgentDashboardComposer,
    private readonly ticketList: TicketListComposer,
    private readonly privacyDossier: PrivacyDossierComposer,
    private readonly services: ServiceClients,
  ) {}

  @MessagePattern(BFF_PATTERNS.ticketDetail)
  getTicketDetail(@Payload() request: TicketDetailRequest) {
    return this.ticketDetail.compose(request);
  }

  @MessagePattern(BFF_PATTERNS.agentDashboard)
  getAgentDashboard(@Payload() request: AgentDashboardRequest) {
    return this.dashboard.compose(request);
  }

  @MessagePattern(BFF_PATTERNS.ticketList)
  getTicketList(@Payload() request: TicketListRequest) {
    return this.ticketList.compose(request);
  }

  @MessagePattern(BFF_PATTERNS.createTicket)
  createTicket(@Payload() payload: Record<string, unknown>) {
    return this.services.tickets(TICKETS_PATTERNS.create, payload);
  }

  @MessagePattern(BFF_PATTERNS.privacyDossier)
  getPrivacyDossier(@Payload() request: PrivacyDossierRequest) {
    return this.privacyDossier.compose(request);
  }
}

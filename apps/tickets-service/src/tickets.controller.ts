import { Controller } from '@nestjs/common';
import { TicketsRepository } from './infrastructure/repositories';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PagedResponseDto, TICKETS_PATTERNS } from '@ticketera/common';
import {
  AddCommentCommand,
  AssignTicketCommand,
  ChangeTicketStatusCommand,
  CreateTicketCommand,
  SearchTicketsQuery,
  TicketCommentView,
  TicketDetailView,
  TicketSummaryView,
} from './application/dto';
import {
  AddCommentUseCase,
  AgentStatsUseCase,
  AgentStatsView,
  AssignTicketUseCase,
  AuthoredCommentView,
  ChangeTicketStatusUseCase,
  CreateTicketUseCase,
  FindCommentsByAuthorQuery,
  FindCommentsByAuthorUseCase,
  GetTicketDetailQuery,
  GetTicketDetailUseCase,
  SearchTicketsUseCase,
  SweepSlaBreachesUseCase,
  SweepSlaResult,
} from './application/use-cases';

/**
 * Borde RPC del servicio de tickets. Es deliberadamente delgado: un mensaje, un
 * caso de uso. Nada de lógica acá — si un handler necesitara un `if` de negocio,
 * ese `if` pertenece al caso de uso o al agregado.
 */
@Controller()
export class TicketsController {
  constructor(
    private readonly createTicket: CreateTicketUseCase,
    private readonly assignTicket: AssignTicketUseCase,
    private readonly changeStatus: ChangeTicketStatusUseCase,
    private readonly addComment: AddCommentUseCase,
    private readonly searchTickets: SearchTicketsUseCase,
    private readonly getDetail: GetTicketDetailUseCase,
    private readonly sweepSla: SweepSlaBreachesUseCase,
    private readonly agentStats: AgentStatsUseCase,
    private readonly ticketsRepository: TicketsRepository,
    private readonly findCommentsByAuthor: FindCommentsByAuthorUseCase,
  ) {}

  @MessagePattern(TICKETS_PATTERNS.create)
  create(@Payload() command: CreateTicketCommand): Promise<TicketSummaryView> {
    return this.createTicket.execute(command);
  }

  @MessagePattern(TICKETS_PATTERNS.findById)
  findById(@Payload() query: GetTicketDetailQuery): Promise<TicketDetailView> {
    return this.getDetail.execute(query);
  }

  /**
   * Búsqueda por código legible. La usa la ingesta de correo para encadenar una
   * respuesta al ticket correcto: el código viaja en el asunto (`[TCK-000123]`).
   *
   * Devuelve null en lugar de lanzar: que el código no exista es un caso esperado
   * —alguien lo escribió mal— y el llamador decide qué hacer.
   */
  @MessagePattern(TICKETS_PATTERNS.findByCode)
  async findByCode(
    @Payload() query: { code: string },
  ): Promise<{ id: string; code: string; status: string } | null> {
    const ticket = await this.ticketsRepository.findByCode(query.code);
    return ticket ? { id: ticket.id, code: ticket.code, status: ticket.status } : null;
  }

  @MessagePattern(TICKETS_PATTERNS.search)
  search(@Payload() query: SearchTicketsQuery): Promise<PagedResponseDto<TicketSummaryView>> {
    return this.searchTickets.execute(query);
  }

  @MessagePattern(TICKETS_PATTERNS.assign)
  assign(@Payload() command: AssignTicketCommand): Promise<TicketSummaryView> {
    return this.assignTicket.execute(command);
  }

  @MessagePattern(TICKETS_PATTERNS.changeStatus)
  changeTicketStatus(
    @Payload() command: ChangeTicketStatusCommand,
  ): Promise<TicketSummaryView> {
    return this.changeStatus.execute(command);
  }

  @MessagePattern(TICKETS_PATTERNS.addComment)
  comment(@Payload() command: AddCommentCommand): Promise<TicketCommentView> {
    return this.addComment.execute(command);
  }

  @MessagePattern(TICKETS_PATTERNS.breachingSla)
  runSlaSweep(): Promise<SweepSlaResult> {
    return this.sweepSla.execute();
  }

  @MessagePattern(TICKETS_PATTERNS.statsByAgent)
  statsByAgent(@Payload() query: { agentId: string }): Promise<AgentStatsView> {
    return this.agentStats.execute(query);
  }

  /** Soporte del dossier de acceso/portabilidad ARCO. */
  @MessagePattern(TICKETS_PATTERNS.findCommentsByAuthor)
  commentsByAuthor(
    @Payload() query: FindCommentsByAuthorQuery,
  ): Promise<AuthoredCommentView[]> {
    return this.findCommentsByAuthor.execute(query);
  }
}

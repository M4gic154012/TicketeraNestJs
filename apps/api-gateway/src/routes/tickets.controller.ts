import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  BFF_PATTERNS,
  CurrentUser,
  Roles,
  TICKETS_PATTERNS,
  UserRole,
} from '@ticketera/common';
import {
  AddCommentDto,
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  SearchTicketsDto,
} from '../dto';
import { UpstreamClient } from './bff.client';

/**
 * Rutas HTTP de tickets.
 *
 * Los controladores del gateway son adaptadores: validan, resuelven la identidad
 * y despachan. Ninguna decisión de negocio vive acá — y el `requesterId` siempre
 * sale del token, nunca del body, para que nadie abra tickets en nombre de otro.
 */
@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(private readonly upstream: UpstreamClient) {}

  @Post()
  @ApiOperation({ summary: 'Crear un ticket' })
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.upstream.toTickets(TICKETS_PATTERNS.create, {
      ...dto,
      requesterId: user.id,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Listar tickets con filtros' })
  list(@Query() query: SearchTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.upstream.toBff(BFF_PATTERNS.ticketList, {
      viewerId: user.id,
      viewerRole: user.role,
      filters: query,
    });
  }

  @Get('dashboard')
  @Roles(UserRole.AGENT, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Tablero del agente autenticado' })
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.upstream.toBff(BFF_PATTERNS.agentDashboard, {
      agentId: user.id,
      agentRole: user.role,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un ticket con permisos y agentes' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.upstream.toBff(BFF_PATTERNS.ticketDetail, {
      ticketId: id,
      viewerId: user.id,
      viewerRole: user.role,
    });
  }

  @Post(':id/assign')
  @Roles(UserRole.AGENT, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Asignar el ticket (manual o por estrategias)' })
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.upstream.toTickets(TICKETS_PATTERNS.assign, {
      ticketId: id,
      assigneeId: dto.assigneeId,
      requestedById: user.id,
      requestedByRole: user.role,
    });
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar el estado del ticket' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.upstream.toTickets(TICKETS_PATTERNS.changeStatus, {
      ticketId: id,
      status: dto.status,
      reason: dto.reason,
      changedById: user.id,
      changedByRole: user.role,
    });
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Comentar un ticket' })
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.upstream.toTickets(TICKETS_PATTERNS.addComment, {
      ticketId: id,
      authorId: user.id,
      authorRole: user.role,
      body: dto.body,
      // Solo el equipo de soporte puede marcar interna; un solicitante que
      // manipule el body no logra crear una nota oculta.
      isInternal: user.role === UserRole.REQUESTER ? false : dto.isInternal,
    });
  }
}

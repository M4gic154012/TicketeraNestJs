import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  BFF_PATTERNS,
  CurrentUser,
  Roles,
  USERS_PATTERNS,
  UserRole,
} from '@ticketera/common';
import {
  CancellationRequestDto,
  CreateUserDto,
  OppositionRequestDto,
  PrivacyBlockDto,
  UpdateUserProfileDto,
} from '../dto';
import { UpstreamClient } from './bff.client';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly upstream: UpstreamClient) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Crear usuario (solo administradores)' })
  create(@Body() dto: CreateUserDto) {
    return this.upstream.toUsers(USERS_PATTERNS.create, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Perfil del usuario autenticado' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.upstream.toUsers(USERS_PATTERNS.findById, { id: user.id });
  }

  @Get('agents')
  @Roles(UserRole.AGENT, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Listar agentes activos' })
  agents(@Query('skill') skill?: string) {
    return this.upstream.toUsers(USERS_PATTERNS.findMany, {
      roles: [UserRole.AGENT, UserRole.SUPERVISOR, UserRole.ADMIN],
      isActive: true,
      skill,
    });
  }

  // --- Derechos ARCO + portabilidad + bloqueo (Ley 21.719) -----------------
  //
  // `/me/...` no lleva @Roles (cualquier autenticado sobre sí mismo). `/:id/...`
  // sí lleva @Roles(ADMIN) — a diferencia de tickets, acá no existe un actor
  // legítimo no-ADMIN que opere sobre el id de OTRO usuario, así que el @Roles
  // en el borde refuerza (no reemplaza) el chequeo fail-closed que igual hace
  // el caso de uso (`assertCan*` de `user-permissions.ts`).

  @Patch('me')
  @ApiOperation({ summary: 'Rectificación: corregir el propio perfil' })
  updateOwnProfile(@Body() dto: UpdateUserProfileDto, @CurrentUser() user: AuthenticatedUser) {
    return this.updateProfile(dto, user, user.id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Rectificación asistida por un administrador' })
  updateProfileAssisted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.updateProfile(dto, user, id);
  }

  @Post('me/cancellation')
  @ApiOperation({ summary: 'Cancelación: suprimir (anonimizar) la propia cuenta' })
  cancelOwn(@Body() dto: CancellationRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cancel(dto, user, user.id);
  }

  @Post(':id/cancellation')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Cancelación asistida por un administrador' })
  cancelAssisted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancellationRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cancel(dto, user, id);
  }

  @Post('me/opposition')
  @ApiOperation({ summary: 'Oposición al tratamiento de los propios datos' })
  opposeOwn(@Body() dto: OppositionRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.oppose(dto, user, user.id);
  }

  @Post(':id/opposition')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Oposición registrada por un administrador en representación' })
  opposeAssisted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OppositionRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.oppose(dto, user, id);
  }

  @Post('me/block')
  @ApiOperation({ summary: 'Bloqueo temporal del tratamiento de los propios datos' })
  blockOwn(@Body() dto: PrivacyBlockDto, @CurrentUser() user: AuthenticatedUser) {
    return this.setBlock(true, dto.reason, user, user.id);
  }

  @Delete('me/block')
  @ApiOperation({ summary: 'Levantar el propio bloqueo temporal' })
  unblockOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.setBlock(false, undefined, user, user.id);
  }

  @Post(':id/block')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Bloqueo temporal asistido por un administrador' })
  blockAssisted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrivacyBlockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.setBlock(true, dto.reason, user, id);
  }

  @Delete(':id/block')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Levantar un bloqueo temporal (administrador)' })
  unblockAssisted(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.setBlock(false, undefined, user, id);
  }

  @Get('me/data-export')
  @ApiOperation({ summary: 'Acceso + portabilidad: dossier completo de datos propios' })
  exportOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.exportData(user, user.id);
  }

  @Get(':id/data-export')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Acceso + portabilidad asistidos por un administrador' })
  exportAssisted(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.exportData(user, id);
  }

  @Get('me/data-subject-requests')
  @ApiOperation({ summary: 'Historial de derechos ARCO ejercidos sobre la propia cuenta' })
  ownRequestHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.requestHistory(user, user.id);
  }

  @Get(':id/data-subject-requests')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Historial de derechos ARCO (administrador)' })
  requestHistoryAssisted(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requestHistory(user, id);
  }

  private updateProfile(
    dto: UpdateUserProfileDto,
    actor: AuthenticatedUser,
    targetUserId: string,
  ) {
    return this.upstream.toUsers(USERS_PATTERNS.updateProfile, {
      ...dto,
      actorId: actor.id,
      actorRole: actor.role,
      targetUserId,
    });
  }

  private cancel(dto: CancellationRequestDto, actor: AuthenticatedUser, targetUserId: string) {
    return this.upstream.toUsers(USERS_PATTERNS.anonymize, {
      reason: dto.reason,
      actorId: actor.id,
      actorRole: actor.role,
      targetUserId,
    });
  }

  private oppose(dto: OppositionRequestDto, actor: AuthenticatedUser, targetUserId: string) {
    return this.upstream.toUsers(USERS_PATTERNS.registerOpposition, {
      reason: dto.reason,
      actorId: actor.id,
      actorRole: actor.role,
      targetUserId,
    });
  }

  private setBlock(
    blocked: boolean,
    reason: string | undefined,
    actor: AuthenticatedUser,
    targetUserId: string,
  ) {
    return this.upstream.toUsers(USERS_PATTERNS.setPrivacyBlock, {
      blocked,
      reason,
      actorId: actor.id,
      actorRole: actor.role,
      targetUserId,
    });
  }

  /** Lectura compuesta (perfil + tickets + comentarios + notificaciones): va al BFF. */
  private exportData(actor: AuthenticatedUser, subjectId: string) {
    return this.upstream.toBff(BFF_PATTERNS.privacyDossier, {
      subjectId,
      requestedById: actor.id,
      requestedByRole: actor.role,
    });
  }

  private requestHistory(actor: AuthenticatedUser, subjectId: string) {
    return this.upstream.toUsers(USERS_PATTERNS.listDataSubjectRequests, {
      actorId: actor.id,
      actorRole: actor.role,
      subjectId,
    });
  }
}

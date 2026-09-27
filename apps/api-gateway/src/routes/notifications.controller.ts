import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
  NOTIFICATIONS_PATTERNS,
} from '@ticketera/common';
import { ListNotificationsDto, MarkAsReadDto } from '../dto';
import { UpstreamClient } from './bff.client';

/**
 * Bandeja de notificaciones.
 *
 * Existía el microservicio con `findForUser` y `markAsRead`, pero ninguna ruta HTTP
 * los alcanzaba: el único consumidor era el dashboard del agente, que requiere rol
 * AGENT o superior. Un solicitante —destinatario de todas las notificaciones in-app
 * de sus tickets— no tenía forma de leerlas, y `markAsRead` era inalcanzable para
 * cualquier rol. Como nada se marcaba como leído y la retención solo borra leídas,
 * la tabla crecía sin techo.
 *
 * Sin `@Roles`: la bandeja es de cada usuario, cualquiera que esté autenticado
 * accede a la suya. El `recipientId` sale del token, nunca de la petición.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly upstream: UpstreamClient) {}

  @Get()
  @ApiOperation({ summary: 'Bandeja de notificaciones del usuario autenticado' })
  list(@Query() query: ListNotificationsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.upstream.toNotifications(NOTIFICATIONS_PATTERNS.findForUser, {
      recipientId: user.id,
      onlyUnread: query.onlyUnread,
      limit: query.limit,
    });
  }

  @Patch('read')
  @ApiOperation({ summary: 'Marcar notificaciones propias como leídas' })
  markAsRead(@Body() dto: MarkAsReadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.upstream.toNotifications(NOTIFICATIONS_PATTERNS.markAsRead, {
      // El destinatario sale del token: el microservicio lo usa en el WHERE, así
      // que enviar ids ajenos no permite tocar la bandeja de otro usuario.
      recipientId: user.id,
      notificationIds: dto.notificationIds,
    });
  }
}

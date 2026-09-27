import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@ticketera/common';
import { ApplicationService } from '@ticketera/patterns';
import { NotificationsRepository } from '../../infrastructure/repositories';

export interface ListNotificationsQuery {
  recipientId: string;
  onlyUnread?: boolean;
  limit?: number;
}

export interface NotificationView {
  id: string;
  eventName: string;
  channel: NotificationChannel;
  subject: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListView {
  items: NotificationView[];
  unreadCount: number;
  /** Total real del destinatario (antes del tope de `limit`). */
  total: number;
}

@Injectable()
export class ListNotificationsUseCase extends ApplicationService<
  ListNotificationsQuery,
  NotificationListView
> {
  constructor(private readonly notifications: NotificationsRepository) {
    super();
  }

  async execute(query: ListNotificationsQuery): Promise<NotificationListView> {
    // Tope duro al límite: es un parámetro que llega del cliente. 5000 (en vez
    // de 100) porque el dossier de acceso/portabilidad ARCO (§PrivacyDossierComposer)
    // pide el historial completo de un titular en una sola llamada.
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 5_000);

    const [items, unreadCount, total] = await Promise.all([
      this.notifications.findForUser(query.recipientId, query.onlyUnread ?? false, limit),
      this.notifications.countUnread(query.recipientId),
      this.notifications.countAll(query.recipientId, query.onlyUnread ?? false),
    ]);

    return {
      items: items.map((n) => ({
        id: n.id,
        eventName: n.eventName,
        channel: n.channel,
        subject: n.subject,
        body: n.body,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
      total,
    };
  }
}

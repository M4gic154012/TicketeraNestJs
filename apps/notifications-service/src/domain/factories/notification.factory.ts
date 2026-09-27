import { Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  TICKET_EVENTS,
} from '@ticketera/common';
import { IntegrationEventMessage } from '@ticketera/patterns';
import { Notification } from '@ticketera/database';
import { randomUUID } from 'node:crypto';

/**
 * Factory de notificaciones (Factory Method por tipo de evento).
 *
 * Un evento de integración produce cero, una o varias notificaciones, con
 * destinatarios y canales distintos según el hecho. Toda esa tabla de decisión
 * vive acá: el caso de uso solo pregunta "¿qué notificaciones corresponden a este
 * evento?" y despacha lo que recibe.
 */
@Injectable()
export class NotificationFactory {
  createFrom(event: IntegrationEventMessage): Notification[] {
    switch (event.eventName) {
      case TICKET_EVENTS.created:
        return this.forTicketCreated(event);
      case TICKET_EVENTS.assigned:
        return this.forTicketAssigned(event);
      case TICKET_EVENTS.statusChanged:
        return this.forStatusChanged(event);
      case TICKET_EVENTS.commented:
        return this.forCommented(event);
      case TICKET_EVENTS.slaBreached:
        return this.forSlaBreached(event);
      case TICKET_EVENTS.resolved:
        return this.forResolved(event);
      default:
        // Un evento desconocido no es un error: puede venir de una versión más
        // nueva del emisor. Se ignora en silencio y se registra arriba.
        return [];
    }
  }

  private forTicketCreated(event: IntegrationEventMessage): Notification[] {
    const { requesterId, code, title } = event.payload as Record<string, string>;

    return [
      this.build(event, {
        recipientId: requesterId,
        channel: NotificationChannel.IN_APP,
        subject: `Ticket ${code} registrado`,
        body: `Recibimos tu solicitud "${title}". Te avisaremos cuando un agente la tome.`,
      }),
    ];
  }

  private forTicketAssigned(event: IntegrationEventMessage): Notification[] {
    const { assigneeId, code } = event.payload as Record<string, string>;

    return [
      this.build(event, {
        recipientId: assigneeId,
        channel: NotificationChannel.EMAIL,
        subject: `Se te asignó el ticket ${code}`,
        body: `El ticket ${code} quedó a tu cargo.`,
      }),
    ];
  }

  /**
   * Un cambio de estado le interesa a quien espera el ticket, no a quien lo movió.
   *
   * Antes notificaba a `changedById`: el agente recibía un aviso por cada cambio que
   * él mismo hacía y el solicitante no se enteraba nunca de que su ticket avanzó.
   */
  private forStatusChanged(event: IntegrationEventMessage): Notification[] {
    const { code, fromStatus, toStatus, changedById, requesterId, assigneeId } =
      event.payload as Record<string, string | null>;

    const notifications: Notification[] = [];

    // El solicitante, salvo que el cambio lo haya hecho él mismo.
    if (requesterId && requesterId !== changedById) {
      notifications.push(
        this.build(event, {
          recipientId: requesterId,
          channel: NotificationChannel.IN_APP,
          subject: `Ticket ${code}: ${toStatus}`,
          body: `Tu ticket pasó de ${fromStatus} a ${toStatus}.`,
        }),
      );
    }

    // El agente asignado, si el cambio vino de otro: un supervisor que reabre, o el
    // solicitante que cierra.
    if (assigneeId && assigneeId !== changedById) {
      notifications.push(
        this.build(event, {
          recipientId: assigneeId,
          channel: NotificationChannel.IN_APP,
          subject: `Ticket ${code}: ${toStatus}`,
          body: `El ticket ${code} que tenés asignado pasó de ${fromStatus} a ${toStatus}.`,
        }),
      );
    }

    return notifications;
  }

  /**
   * Un comentario le interesa a la otra parte de la conversación, nunca a su autor:
   * antes se notificaba a `authorId`, así que quien comentaba recibía el aviso de su
   * propio comentario.
   */
  private forCommented(event: IntegrationEventMessage): Notification[] {
    const { code, authorId, excerpt, isInternal, requesterId, assigneeId } =
      event.payload as Record<string, unknown>;

    // Una nota interna no genera aviso al solicitante: notificarla revelaría su
    // existencia, que es justamente lo que la hace interna.
    if (isInternal === true) return [];

    const author = String(authorId);
    const destinatarios = [requesterId, assigneeId]
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .filter((id) => id !== author);

    // Deduplicado: si el solicitante es además el asignado, no recibe dos avisos del
    // mismo comentario.
    return [...new Set(destinatarios)].map((recipientId) =>
      this.build(event, {
        recipientId,
        channel: NotificationChannel.IN_APP,
        subject: `Nuevo comentario en ${code}`,
        body: String(excerpt),
      }),
    );
  }

  private forSlaBreached(event: IntegrationEventMessage): Notification[] {
    const { code, assigneeId, minutesOverdue } = event.payload as Record<string, string | null>;

    // Sin agente asignado no hay a quién avisar por este canal; el tablero de
    // supervisión igual lo muestra por la consulta de vencidos.
    if (!assigneeId) return [];

    return [
      this.build(event, {
        recipientId: assigneeId,
        channel: NotificationChannel.EMAIL,
        subject: `SLA incumplido en ${code}`,
        body: `El ticket ${code} lleva ${minutesOverdue} minutos vencido.`,
      }),
    ];
  }

  private forResolved(event: IntegrationEventMessage): Notification[] {
    const { code, requesterId, resolutionMinutes } = event.payload as Record<string, unknown>;

    return [
      this.build(event, {
        recipientId: String(requesterId),
        channel: NotificationChannel.EMAIL,
        subject: `Ticket ${code} resuelto`,
        body: `Resolvimos tu ticket en ${resolutionMinutes} minutos. Si el problema persiste, podés reabrirlo.`,
      }),
    ];
  }

  private build(
    event: IntegrationEventMessage,
    data: {
      recipientId: string;
      channel: NotificationChannel;
      subject: string;
      body: string;
    },
  ): Notification {
    const notification = new Notification();
    notification.id = randomUUID();
    // Se conserva el eventId del emisor: junto al destinatario y el canal forma
    // la clave de idempotencia que evita duplicados si el evento se reentrega.
    notification.eventId = event.eventId;
    notification.eventName = event.eventName;
    notification.recipientId = data.recipientId;
    notification.channel = data.channel;
    notification.subject = data.subject.slice(0, 200);
    notification.body = data.body;
    notification.metadata = { aggregateId: event.aggregateId, occurredAt: event.occurredAt };
    notification.sentAt = null;
    notification.readAt = null;
    notification.attempts = 0;
    notification.lastError = null;

    return notification;
  }
}

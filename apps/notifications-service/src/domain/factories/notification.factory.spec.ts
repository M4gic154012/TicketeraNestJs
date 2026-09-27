import { NotificationChannel, TICKET_EVENTS } from '@ticketera/common';
import { IntegrationEventMessage } from '@ticketera/patterns';
import { randomUUID } from 'node:crypto';
import { NotificationFactory } from './notification.factory';

describe('NotificationFactory', () => {
  const factory = new NotificationFactory();

  const event = (
    eventName: string,
    payload: Record<string, unknown>,
  ): IntegrationEventMessage => ({
    eventId: randomUUID(),
    eventName,
    aggregateId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload,
  });

  it('un ticket creado avisa al solicitante por bandeja in-app', () => {
    const requesterId = randomUUID();
    const [notification] = factory.createFrom(
      event(TICKET_EVENTS.created, {
        requesterId,
        code: 'TCK-000001',
        title: 'Sin red',
      }),
    );

    expect(notification.recipientId).toBe(requesterId);
    expect(notification.channel).toBe(NotificationChannel.IN_APP);
    expect(notification.subject).toContain('TCK-000001');
  });

  it('una asignación avisa al agente por email', () => {
    const assigneeId = randomUUID();
    const [notification] = factory.createFrom(
      event(TICKET_EVENTS.assigned, { assigneeId, code: 'TCK-000002' }),
    );

    expect(notification.recipientId).toBe(assigneeId);
    expect(notification.channel).toBe(NotificationChannel.EMAIL);
  });

  it('una nota interna no genera notificación', () => {
    const result = factory.createFrom(
      event(TICKET_EVENTS.commented, {
        code: 'TCK-000003',
        authorId: randomUUID(),
        excerpt: 'reviso stock',
        isInternal: true,
      }),
    );

    expect(result).toHaveLength(0);
  });

  /**
   * Regresión. El test original solo contaba las notificaciones y nunca verificaba
   * A QUIÉN se le avisaba — y el destinatario estaba mal: se notificaba al autor de
   * su propio comentario, y al que hacía el cambio de estado de su propio cambio,
   * mientras el solicitante no se enteraba de nada sobre su ticket.
   */
  describe('destinatarios', () => {
    const requesterId = randomUUID();
    const assigneeId = randomUUID();

    it('un comentario del agente avisa al solicitante, no al autor', () => {
      const result = factory.createFrom(
        event(TICKET_EVENTS.commented, {
          code: 'TCK-000003',
          authorId: assigneeId,
          excerpt: 'ya lo vemos',
          isInternal: false,
          requesterId,
          assigneeId,
        }),
      );

      expect(result.map((n) => n.recipientId)).toEqual([requesterId]);
    });

    it('un comentario del solicitante avisa al agente asignado', () => {
      const result = factory.createFrom(
        event(TICKET_EVENTS.commented, {
          code: 'TCK-000003',
          authorId: requesterId,
          excerpt: 'agrego información',
          isInternal: false,
          requesterId,
          assigneeId,
        }),
      );

      expect(result.map((n) => n.recipientId)).toEqual([assigneeId]);
    });

    it('nadie se notifica su propio comentario', () => {
      const result = factory.createFrom(
        event(TICKET_EVENTS.commented, {
          code: 'TCK-000003',
          authorId: assigneeId,
          excerpt: 'nota',
          isInternal: false,
          requesterId: assigneeId,
          assigneeId,
        }),
      );

      expect(result).toHaveLength(0);
    });

    it('un cambio de estado del agente avisa al solicitante', () => {
      const result = factory.createFrom(
        event(TICKET_EVENTS.statusChanged, {
          code: 'TCK-000004',
          fromStatus: 'ASSIGNED',
          toStatus: 'IN_PROGRESS',
          changedById: assigneeId,
          requesterId,
          assigneeId,
        }),
      );

      expect(result.map((n) => n.recipientId)).toEqual([requesterId]);
    });

    it('un cambio de estado del solicitante avisa al agente asignado', () => {
      const result = factory.createFrom(
        event(TICKET_EVENTS.statusChanged, {
          code: 'TCK-000004',
          fromStatus: 'RESOLVED',
          toStatus: 'CLOSED',
          changedById: requesterId,
          requesterId,
          assigneeId,
        }),
      );

      expect(result.map((n) => n.recipientId)).toEqual([assigneeId]);
    });

    it('un cambio de un supervisor avisa a las dos partes', () => {
      const result = factory.createFrom(
        event(TICKET_EVENTS.statusChanged, {
          code: 'TCK-000004',
          fromStatus: 'RESOLVED',
          toStatus: 'IN_PROGRESS',
          changedById: randomUUID(),
          requesterId,
          assigneeId,
        }),
      );

      expect(new Set(result.map((n) => n.recipientId))).toEqual(
        new Set([requesterId, assigneeId]),
      );
    });

    it('un ticket resuelto avisa al solicitante', () => {
      const result = factory.createFrom(
        event(TICKET_EVENTS.resolved, {
          code: 'TCK-000005',
          requesterId,
          resolvedById: assigneeId,
          resolutionMinutes: 42,
          withinSla: true,
        }),
      );

      expect(result.map((n) => n.recipientId)).toEqual([requesterId]);
    });
  });

  it('un SLA incumplido sin agente asignado no notifica a nadie', () => {
    const result = factory.createFrom(
      event(TICKET_EVENTS.slaBreached, {
        code: 'TCK-000004',
        assigneeId: null,
        minutesOverdue: 30,
      }),
    );

    expect(result).toHaveLength(0);
  });

  it('un evento desconocido se ignora en lugar de fallar', () => {
    expect(factory.createFrom(event('ticket.inventado', {}))).toHaveLength(0);
  });

  it('conserva el eventId del emisor para la clave de idempotencia', () => {
    const source = event(TICKET_EVENTS.created, {
      requesterId: randomUUID(),
      code: 'TCK-000005',
      title: 'X',
    });

    const [notification] = factory.createFrom(source);

    expect(notification.eventId).toBe(source.eventId);
    expect(notification.eventName).toBe(source.eventName);
  });

  it('recorta el asunto al largo máximo de la columna', () => {
    const [notification] = factory.createFrom(
      event(TICKET_EVENTS.created, {
        requesterId: randomUUID(),
        code: 'T'.repeat(300),
        title: 'Título',
      }),
    );

    expect(notification.subject.length).toBeLessThanOrEqual(200);
  });

  it('nace sin enviar y sin intentos', () => {
    const [notification] = factory.createFrom(
      event(TICKET_EVENTS.created, {
        requesterId: randomUUID(),
        code: 'TCK-000006',
        title: 'Y',
      }),
    );

    expect(notification.sentAt).toBeNull();
    expect(notification.readAt).toBeNull();
    expect(notification.attempts).toBe(0);
  });
});

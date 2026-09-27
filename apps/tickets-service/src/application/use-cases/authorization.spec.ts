import {
  InvalidStateTransitionError,
  TicketStatus,
  UnauthorizedActionError,
  UserRole,
} from '@ticketera/common';
import { randomUUID } from 'node:crypto';
import { AddCommentUseCase } from './add-comment.use-case';
import { ChangeTicketStatusUseCase } from './change-ticket-status.use-case';

/**
 * Regresión de la falla de autorización a nivel de objeto.
 *
 * Un pentest confirmó que cualquier usuario autenticado podía cerrar y comentar
 * tickets ajenos conociendo su UUID: el gateway no validaba rol en esas rutas
 * (el solicitante legítimo también las necesita) y el caso de uso dejaba pasar a
 * los "terceros" asumiendo que el gateway ya había filtrado.
 *
 * Se prueba el método de autorización de forma aislada, sin base ni transacción:
 * lo que hay que fijar es la decisión, no el camino de persistencia.
 */
describe('Autorización a nivel de objeto (regresión de IDOR)', () => {
  const requesterId = randomUUID();
  const assigneeId = randomUUID();
  const strangerId = randomUUID();
  const ticketId = randomUUID();

  describe('ChangeTicketStatusUseCase', () => {
    const useCase = new ChangeTicketStatusUseCase(
      {} as never,
      {} as never,
      {} as never,
    );

    // El método es privado por diseño; se accede explícitamente porque es la
    // unidad de decisión que este test debe fijar.
    /**
     * @param currentStatus estado actual del ticket. La autorización es la
     *   intersección de la máquina de estados con los permisos del actor, así que
     *   sin el estado de partida no se puede decidir.
     */
    const assertCanChange = (
      changedById: string,
      changedByRole: UserRole,
      status: TicketStatus,
      currentStatus: TicketStatus = TicketStatus.ASSIGNED,
    ) =>
      (
        useCase as unknown as {
          assertCanChange: (
            c: {
              ticketId: string;
              status: TicketStatus;
              changedById: string;
              changedByRole: UserRole;
            },
            assigneeId: string | null,
            requesterId: string,
            currentStatus: TicketStatus,
          ) => void;
        }
      ).assertCanChange(
        { ticketId, status, changedById, changedByRole },
        assigneeId,
        requesterId,
        currentStatus,
      );

    it('rechaza a un tercero sin relación con el ticket', () => {
      expect(() =>
        assertCanChange(strangerId, UserRole.REQUESTER, TicketStatus.CLOSED),
      ).toThrow(UnauthorizedActionError);
    });

    it('rechaza a un agente que no es el asignado', () => {
      expect(() =>
        assertCanChange(strangerId, UserRole.AGENT, TicketStatus.IN_PROGRESS),
      ).toThrow(UnauthorizedActionError);
    });

    it('permite al agente asignado', () => {
      expect(() =>
        assertCanChange(assigneeId, UserRole.AGENT, TicketStatus.IN_PROGRESS),
      ).not.toThrow();
    });

    it('permite al supervisor sobre cualquier ticket', () => {
      expect(() =>
        assertCanChange(strangerId, UserRole.SUPERVISOR, TicketStatus.IN_PROGRESS),
      ).not.toThrow();
      expect(() =>
        assertCanChange(strangerId, UserRole.ADMIN, TicketStatus.CLOSED),
      ).not.toThrow();
    });

    it('el solicitante puede cerrar su propio ticket', () => {
      // Desde ASSIGNED, CLOSED es legal en la máquina y está permitido al solicitante.
      expect(() =>
        assertCanChange(requesterId, UserRole.REQUESTER, TicketStatus.CLOSED),
      ).not.toThrow();
    });

    it('el solicitante no puede declarar avance en su propio ticket', () => {
      // IN_PROGRESS desde ASSIGNED es legal en la máquina pero no le corresponde a
      // él: declarar que el trabajo arrancó es una afirmación del equipo. Devuelve
      // 409 con la lista de lo que sí puede, no un 403 opaco.
      expect(() =>
        assertCanChange(
          requesterId,
          UserRole.REQUESTER,
          TicketStatus.IN_PROGRESS,
          TicketStatus.ASSIGNED,
        ),
      ).toThrow(InvalidStateTransitionError);
    });

    it('desde WAITING_CUSTOMER el solicitante puede devolver el ticket al equipo', () => {
      // Regresión: en este estado quedaba sin ninguna acción disponible — cerrar
      // daba 409 por la máquina de estados, y las transiciones legales daban 403
      // por el rol. Es justo el estado que espera que él responda.
      expect(() =>
        assertCanChange(
          requesterId,
          UserRole.REQUESTER,
          TicketStatus.IN_PROGRESS,
          TicketStatus.WAITING_CUSTOMER,
        ),
      ).not.toThrow();
    });

    it('el solicitante puede reabrir un ticket resuelto que no quedó resuelto', () => {
      // La notificación de resolución le promete que puede reabrirlo; antes el
      // sistema se lo negaba.
      expect(() =>
        assertCanChange(
          requesterId,
          UserRole.REQUESTER,
          TicketStatus.IN_PROGRESS,
          TicketStatus.RESOLVED,
        ),
      ).not.toThrow();
    });
  });

  describe('AddCommentUseCase', () => {
    const useCase = new AddCommentUseCase({} as never, {} as never, {} as never);

    const assertCanComment = (authorId: string, authorRole: UserRole) =>
      (
        useCase as unknown as {
          assertCanComment: (
            c: { ticketId: string; authorId: string; authorRole: UserRole; body: string },
            assigneeId: string | null,
            requesterId: string,
          ) => void;
        }
      ).assertCanComment(
        { ticketId, authorId, authorRole, body: 'texto' },
        assigneeId,
        requesterId,
      );

    it('rechaza a un solicitante ajeno al ticket', () => {
      expect(() => assertCanComment(strangerId, UserRole.REQUESTER)).toThrow(
        UnauthorizedActionError,
      );
    });

    it('permite al solicitante dueño del ticket', () => {
      expect(() => assertCanComment(requesterId, UserRole.REQUESTER)).not.toThrow();
    });

    it('permite a cualquier integrante del equipo de soporte', () => {
      expect(() => assertCanComment(strangerId, UserRole.AGENT)).not.toThrow();
      expect(() => assertCanComment(strangerId, UserRole.SUPERVISOR)).not.toThrow();
    });
  });
});

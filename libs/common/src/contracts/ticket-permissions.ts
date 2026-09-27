import { ALLOWED_STATUS_TRANSITIONS, TicketStatus, UserRole } from './enums';

/**
 * Quién puede hacer qué sobre un ticket.
 *
 * Fuente ÚNICA de las reglas de permisos. Antes estaban escritas dos veces con
 * lógica distinta: el caso de uso decidía una cosa y `TicketDetailComposer`
 * informaba otra al frontend. El resultado era que la UI le escondía al solicitante
 * el botón de cerrar su propio ticket (que sí podía) y le ofrecía al agente no
 * asignado acciones que devolvían 403.
 *
 * Vive en `common` justamente para que el BFF y el microservicio no puedan
 * desincronizarse: los dos importan de acá.
 */

export interface TicketActor {
  id: string;
  role: UserRole;
}

export interface TicketContext {
  requesterId: string;
  assigneeId: string | null;
  status: TicketStatus;
}

const isSupportStaff = (role: UserRole): boolean => role !== UserRole.REQUESTER;

const isSupervisor = (role: UserRole): boolean =>
  role === UserRole.SUPERVISOR || role === UserRole.ADMIN;

/**
 * Qué puede hacer el solicitante con su propio ticket, **según el estado en que
 * esté**. Depende del origen y no es una lista plana: declarar "en progreso" desde
 * ASSIGNED es una afirmación del equipo de soporte, mientras que hacerlo desde
 * RESOLVED es reabrir y desde WAITING_CUSTOMER es responder y devolver el ticket.
 * La misma transición significa cosas distintas según de dónde venga.
 */
export const REQUESTER_TRANSITIONS: Readonly<Partial<Record<TicketStatus, TicketStatus[]>>> = {
  // Puede cerrar mientras el trabajo no arrancó o ya terminó.
  [TicketStatus.OPEN]: [TicketStatus.CLOSED],
  [TicketStatus.ASSIGNED]: [TicketStatus.CLOSED],
  [TicketStatus.IN_PROGRESS]: [],
  // Es su turno de responder: devolver el ticket al equipo es justamente lo que se
  // espera de él acá. Antes quedaba sin ninguna acción disponible en este estado.
  [TicketStatus.WAITING_CUSTOMER]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
  // Reabrir lo que se declaró resuelto pero no lo estaba, o confirmar el cierre. Es
  // la contraparte de la notificación que le promete que puede reabrirlo.
  [TicketStatus.RESOLVED]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
  [TicketStatus.CLOSED]: [],
};

export function canComment(actor: TicketActor, ticket: TicketContext): boolean {
  if (isSupportStaff(actor.role)) return true;
  return actor.id === ticket.requesterId;
}

export function canAddInternalNote(actor: TicketActor): boolean {
  return isSupportStaff(actor.role);
}

export function canReassign(actor: TicketActor, ticket: TicketContext): boolean {
  if (isSupervisor(actor.role)) return true;
  // Un agente puede tomar un ticket libre, pero no arrebatarle el de otro agente:
  // antes cualquier AGENT reasignaba cualquier ticket a sí mismo.
  return actor.role === UserRole.AGENT && ticket.assigneeId === null;
}

/**
 * Estados alcanzables por este actor sobre este ticket: la intersección de lo que
 * permite la máquina de estados con lo que permite su rol y su relación.
 *
 * Calcular la intersección (en vez de las dos tablas por separado) es lo que evita
 * que un solicitante quede sin ninguna acción disponible, como pasaba en
 * WAITING_CUSTOMER: cerrar daba 409 por la máquina y las transiciones legales daban
 * 403 por el rol.
 */
export function allowedNextStatuses(
  actor: TicketActor,
  ticket: TicketContext,
): TicketStatus[] {
  const byStateMachine = ALLOWED_STATUS_TRANSITIONS[ticket.status];

  if (isSupervisor(actor.role)) return [...byStateMachine];
  if (actor.id === ticket.assigneeId) return [...byStateMachine];

  if (actor.id === ticket.requesterId) {
    // Intersección de lo que permite la máquina con lo que le corresponde al
    // solicitante EN ESTE ESTADO. Calcularla (en vez de aplicar las dos tablas por
    // separado) es lo que evita que se quede sin ninguna acción disponible.
    const forRequester = REQUESTER_TRANSITIONS[ticket.status] ?? [];
    return byStateMachine.filter((s) => forRequester.includes(s));
  }

  // Agente no asignado y sin relación con el ticket.
  return [];
}

export function canChangeStatus(actor: TicketActor, ticket: TicketContext): boolean {
  return allowedNextStatuses(actor, ticket).length > 0;
}

export function buildTicketPermissions(actor: TicketActor, ticket: TicketContext) {
  return {
    canComment: canComment(actor, ticket),
    canAddInternalNote: canAddInternalNote(actor),
    canReassign: canReassign(actor, ticket),
    canChangeStatus: canChangeStatus(actor, ticket),
    /** Estados concretos que el cliente puede ofrecer sin recibir un 409 o un 403. */
    allowedNextStatuses: allowedNextStatuses(actor, ticket),
  };
}

import { UnauthorizedActionError } from '../filters/domain.errors';
import { UserRole } from './enums';

/**
 * Quién puede ejercer un derecho ARCO/portabilidad/bloqueo sobre los datos de
 * qué usuario.
 *
 * Fuente ÚNICA de esta regla — el BFF y `users-service` importan de acá, igual
 * que `ticket-permissions.ts` para tickets. A diferencia de tickets, acá NO
 * hay un "equipo de soporte" con acceso: ni AGENT ni SUPERVISOR pueden ejercer
 * un derecho en nombre de otro usuario, solo el propio titular o un ADMIN en
 * representación. Es mínimo privilegio deliberado para datos personales.
 */

export interface PrivacyActor {
  id: string;
  role: UserRole;
}

const isSelf = (actor: PrivacyActor, subjectId: string): boolean => actor.id === subjectId;
const isAdmin = (actor: PrivacyActor): boolean => actor.role === UserRole.ADMIN;

function assertCanActOnPrivacyData(actor: PrivacyActor, subjectId: string): void {
  if (isSelf(actor, subjectId)) return;
  if (isAdmin(actor)) return;
  throw new UnauthorizedActionError(
    'No tiene permiso para ejercer derechos sobre los datos de este usuario',
    { subjectId },
  );
}

// Funciones separadas por derecho (no una sola genérica): el BFF y el gateway
// necesitan poder preguntar "¿puedo ofrecer este botón?" por derecho, y mañana
// alguna puede diferenciarse sin romper la firma de las demás.
export function assertCanAccess(actor: PrivacyActor, subjectId: string): void {
  assertCanActOnPrivacyData(actor, subjectId);
}

export function assertCanRectify(actor: PrivacyActor, subjectId: string): void {
  assertCanActOnPrivacyData(actor, subjectId);
}

export function assertCanCancel(actor: PrivacyActor, subjectId: string): void {
  assertCanActOnPrivacyData(actor, subjectId);
}

export function assertCanOppose(actor: PrivacyActor, subjectId: string): void {
  assertCanActOnPrivacyData(actor, subjectId);
}

export function assertCanPort(actor: PrivacyActor, subjectId: string): void {
  assertCanActOnPrivacyData(actor, subjectId);
}

export function assertCanBlock(actor: PrivacyActor, subjectId: string): void {
  assertCanActOnPrivacyData(actor, subjectId);
}

export function assertCanUnblock(actor: PrivacyActor, subjectId: string): void {
  assertCanActOnPrivacyData(actor, subjectId);
}

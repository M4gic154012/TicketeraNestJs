import { DataSubjectRequestStatus, DataSubjectRequestType, UserRole } from '@ticketera/common';
import { DataSubjectRequest, User } from '@ticketera/database';

export interface CreateUserCommand {
  email: string;
  fullName: string;
  password: string;
  role?: UserRole;
  department?: string;
  skills?: string[];
  maxConcurrentTickets?: number;
}

export interface FindManyUsersQuery {
  ids?: string[];
  roles?: UserRole[];
  isActive?: boolean;
  skill?: string;
}

export interface ValidateCredentialsCommand {
  email: string;
  password: string;
}

/**
 * Vista pública de usuario. Nunca incluye passwordHash: aunque la columna esté
 * marcada `select: false`, un método que la cargue explícitamente podría
 * filtrarla si se serializara la entidad directo.
 */
export interface UserView {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  department: string | null;
  isActive: boolean;
  skills: string[];
  maxConcurrentTickets: number | null;
}

export function toUserView(user: User): UserView {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    department: user.department,
    isActive: user.isActive,
    skills: user.skills ?? [],
    maxConcurrentTickets: user.maxConcurrentTickets,
  };
}

// --- Derechos ARCO + portabilidad + bloqueo (Ley 21.719) -------------------

/** Quién ejerce el derecho, y sobre quién: el titular sobre sí mismo o un ADMIN. */
export interface PrivacyActionActor {
  actorId: string;
  actorRole: UserRole;
  targetUserId: string;
}

export interface UpdateUserProfileCommand extends PrivacyActionActor {
  fullName?: string;
  email?: string;
  department?: string;
}

export interface AnonymizeUserCommand extends PrivacyActionActor {
  reason: string;
}

export interface AnonymizeUserResult {
  id: string;
  anonymizedAt: string;
}

export interface SetPrivacyBlockCommand extends PrivacyActionActor {
  blocked: boolean;
  reason?: string;
}

export interface RegisterOppositionCommand extends PrivacyActionActor {
  reason: string;
}

export interface RegisterOppositionResult {
  requestId: string;
  status: DataSubjectRequestStatus;
}

export interface ListDataSubjectRequestsQuery {
  actorId: string;
  actorRole: UserRole;
  subjectId: string;
}

export interface DataSubjectRequestView {
  id: string;
  type: DataSubjectRequestType;
  status: DataSubjectRequestStatus;
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function toDataSubjectRequestView(request: DataSubjectRequest): DataSubjectRequestView {
  return {
    id: request.id,
    type: request.type,
    status: request.status,
    reason: request.reason,
    createdAt: request.createdAt.toISOString(),
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
  };
}

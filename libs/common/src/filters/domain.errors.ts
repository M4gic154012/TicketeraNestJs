/**
 * Errores de dominio: independientes del transporte. El dominio y la capa de
 * aplicación lanzan estos, nunca HttpException — así el mismo caso de uso sirve
 * para HTTP, para RPC y para un job, y el mapeo a códigos vive en un solo lugar.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  /** Status HTTP equivalente, usado por el traductor del borde. */
  abstract readonly httpStatus: number;

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class EntityNotFoundError extends DomainError {
  readonly code = 'ENTITY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(entity: string, id: string) {
    super(`No se encontró ${entity} con id ${id}`, { entity, id });
  }
}

export class BusinessRuleViolationError extends DomainError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly httpStatus = 409;
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'INVALID_STATE_TRANSITION';
  readonly httpStatus = 409;

  constructor(from: string, to: string, allowed: string[]) {
    super(`Transición no permitida de ${from} a ${to}`, { from, to, allowed });
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;
}

/**
 * Falta o falla la autenticación (401), distinto de tener identidad pero no
 * permiso (403). Devolver 403 en un login fallido confunde al cliente: sugiere
 * que la credencial es válida pero insuficiente.
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly httpStatus = 401;
}

export class UnauthorizedActionError extends DomainError {
  readonly code = 'UNAUTHORIZED_ACTION';
  readonly httpStatus = 403;
}

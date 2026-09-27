export enum TicketStatus {
  OPEN = 'OPEN',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_CUSTOMER = 'WAITING_CUSTOMER',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum TicketCategory {
  HARDWARE = 'HARDWARE',
  SOFTWARE = 'SOFTWARE',
  NETWORK = 'NETWORK',
  ACCESS = 'ACCESS',
  OTHER = 'OTHER',
}

export enum UserRole {
  REQUESTER = 'REQUESTER',
  AGENT = 'AGENT',
  SUPERVISOR = 'SUPERVISOR',
  ADMIN = 'ADMIN',
}

/** Por dónde entró un ticket al sistema. */
export enum TicketSourceChannel {
  WEB = 'WEB',
  EMAIL = 'EMAIL',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  WEBHOOK = 'WEBHOOK',
}

/** Los 6 derechos ARCO + portabilidad + bloqueo, para el rastro auditable. */
export enum DataSubjectRequestType {
  ACCESS = 'ACCESS',
  RECTIFICATION = 'RECTIFICATION',
  CANCELLATION = 'CANCELLATION',
  OPPOSITION = 'OPPOSITION',
  PORTABILITY = 'PORTABILITY',
  BLOCK = 'BLOCK',
  UNBLOCK = 'UNBLOCK',
}

export enum DataSubjectRequestStatus {
  RECEIVED = 'RECEIVED',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}

/**
 * Transiciones de estado permitidas. Vive en common porque el gateway valida
 * temprano y el dominio la vuelve a aplicar: la validación de borde es
 * conveniencia, la del dominio es la que manda.
 */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<TicketStatus, TicketStatus[]>> = {
  [TicketStatus.OPEN]: [TicketStatus.ASSIGNED, TicketStatus.CLOSED],
  [TicketStatus.ASSIGNED]: [TicketStatus.IN_PROGRESS, TicketStatus.OPEN, TicketStatus.CLOSED],
  [TicketStatus.IN_PROGRESS]: [
    TicketStatus.WAITING_CUSTOMER,
    TicketStatus.RESOLVED,
    TicketStatus.ASSIGNED,
  ],
  [TicketStatus.WAITING_CUSTOMER]: [TicketStatus.IN_PROGRESS, TicketStatus.RESOLVED],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
  [TicketStatus.CLOSED]: [],
};

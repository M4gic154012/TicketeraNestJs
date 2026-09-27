import {
  TicketCategory,
  TicketPriority,
  TicketSourceChannel,
  TicketStatus,
  UserRole,
} from '@ticketera/common';

/**
 * Comandos y queries del servicio de tickets: la forma exacta de los mensajes
 * que llegan por RPC. Son objetos planos, sin decoradores de HTTP: la validación
 * de entrada del cliente ya ocurrió en el gateway, acá solo se valida lo que
 * afecta invariantes de negocio.
 */

export interface CreateTicketCommand {
  title: string;
  description: string;
  requesterId: string;
  category: TicketCategory;
  priority?: TicketPriority;
  tags?: string[];
  /** Si true, se asigna un agente inmediatamente tras crear. */
  autoAssign?: boolean;
  /** Por dónde entró. Por omisión WEB; la ingesta de correo manda EMAIL. */
  sourceChannel?: TicketSourceChannel;
  /** Message-ID del correo que lo originó, para encadenar respuestas. */
  sourceMessageId?: string;
}

export interface AssignTicketCommand {
  ticketId: string;
  /** Asignación manual. Si se omite, deciden las estrategias. */
  assigneeId?: string;
  requestedById: string;
  /** Rol de quien pide la asignación. Obligatorio: la autorización depende de él. */
  requestedByRole: UserRole;
}

export interface ChangeTicketStatusCommand {
  ticketId: string;
  status: TicketStatus;
  changedById: string;
  /**
   * Rol del actor, tomado del token por el gateway. Es obligatorio: la
   * autorización de este caso de uso depende del rol Y de la relación con el
   * ticket, y ninguna de las dos se puede deducir solo del id.
   */
  changedByRole: UserRole;
  reason?: string;
}

export interface AddCommentCommand {
  ticketId: string;
  authorId: string;
  /** Message-ID del correo del que salió el comentario, si vino por esa vía. */
  sourceMessageId?: string;
  /** Rol del autor, tomado del token por el gateway. Ver ChangeTicketStatusCommand. */
  authorRole: UserRole;
  body: string;
  isInternal?: boolean;
}

export interface SearchTicketsQuery {
  statuses?: TicketStatus[];
  priorities?: TicketPriority[];
  category?: TicketCategory;
  assigneeId?: string;
  requesterId?: string;
  unassignedOnly?: boolean;
  overdueOnly?: boolean;
  tag?: string;
  text?: string;
  createdFrom?: string;
  createdTo?: string;
  page: number;
  pageSize: number;
  orderBy?: string;
  order?: 'ASC' | 'DESC';
}

import { TicketCategory, TicketPriority, TicketStatus } from '@ticketera/common';
import { Ticket } from '@ticketera/database';

/**
 * Vistas de salida del servicio.
 *
 * El servicio nunca devuelve la entidad TypeORM cruda: arrastraría relaciones
 * no cargadas, el passwordHash de un usuario incluido en un join y metadatos
 * internos. Estos objetos son el contrato con el BFF.
 */

export interface UserSummaryView {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export interface TicketSummaryView {
  id: string;
  code: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  requester: UserSummaryView | null;
  assignee: UserSummaryView | null;
  slaDueAt: string | null;
  slaBreached: boolean;
  isOverdue: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketCommentView {
  id: string;
  body: string;
  isInternal: boolean;
  author: UserSummaryView | null;
  createdAt: string;
}

export interface TicketStatusHistoryView {
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  changedById: string | null;
  reason: string | null;
  changedAt: string;
}

export interface TicketDetailView extends TicketSummaryView {
  description: string;
  comments: TicketCommentView[];
  statusHistory: TicketStatusHistoryView[];
  firstResponseAt: string | null;
  resolvedAt: string | null;
  resolutionMinutes: number | null;
}

export function toUserSummary(user?: {
  id: string;
  fullName: string;
  email: string;
  role: string;
} | null): UserSummaryView | null {
  if (!user) return null;
  return { id: user.id, fullName: user.fullName, email: user.email, role: user.role };
}

export function toTicketSummary(ticket: Ticket): TicketSummaryView {
  return {
    id: ticket.id,
    code: ticket.code,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    requester: toUserSummary(ticket.requester ?? null),
    assignee: toUserSummary(ticket.assignee ?? null),
    slaDueAt: ticket.slaDueAt?.toISOString() ?? null,
    slaBreached: ticket.slaBreached,
    isOverdue: ticket.isOverdue(),
    tags: ticket.tags,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

/**
 * @param includeInternal las notas internas entre agentes no se exponen al
 *   solicitante. Quien llama decide, porque solo el borde conoce el rol.
 */
export function toTicketDetail(ticket: Ticket, includeInternal: boolean): TicketDetailView {
  return {
    ...toTicketSummary(ticket),
    description: ticket.description,
    comments: (ticket.comments ?? [])
      .filter((comment) => includeInternal || !comment.isInternal)
      .map((comment) => ({
        id: comment.id,
        body: comment.body,
        isInternal: comment.isInternal,
        author: toUserSummary(comment.author ?? null),
        createdAt: comment.createdAt.toISOString(),
      })),
    statusHistory: (ticket.statusHistory ?? []).map((entry) => ({
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      changedById: entry.changedById,
      reason: entry.reason,
      changedAt: entry.changedAt.toISOString(),
    })),
    firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    resolutionMinutes: ticket.resolutionMinutes(),
  };
}

import { TicketCategory, TicketPriority } from '@ticketera/common';
import { Ticket, User } from '@ticketera/database';
import { Strategy } from '@ticketera/patterns';

/** Contexto que reciben todas las estrategias de asignación. */
export interface AssignmentContext {
  ticket: Ticket;
  /** Agentes activos candidatos, ya filtrados por el caso de uso. */
  candidates: AgentWorkload[];
  category: TicketCategory;
  priority: TicketPriority;
}

/** Agente más su carga actual, para decidir sin volver a consultar la base. */
export interface AgentWorkload {
  agent: User;
  openTickets: number;
  /** Tickets con SLA ya vencido en su cola. Señal de agente saturado. */
  overdueTickets: number;
}

export interface AssignmentResult {
  assignee: User;
  /** Por qué se eligió. Se guarda en el evento para poder auditar la decisión. */
  rationale: string;
}

export type AssignmentStrategy = Strategy<AssignmentContext, AssignmentResult | null>;

export const ASSIGNMENT_STRATEGIES = 'ASSIGNMENT_STRATEGIES';

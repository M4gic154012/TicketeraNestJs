import { TicketCategory, TicketPriority } from '@ticketera/common';
import { Strategy } from '@ticketera/patterns';

export interface SlaContext {
  priority: TicketPriority;
  category: TicketCategory;
  /** Momento de creación del ticket, base del cálculo. */
  createdAt: Date;
  /** Si el solicitante pertenece a un área con atención prioritaria. */
  isVipRequester: boolean;
}

export interface SlaResult {
  dueAt: Date;
  minutes: number;
  policyName: string;
}

export type SlaStrategy = Strategy<SlaContext, SlaResult>;

export const SLA_STRATEGIES = 'SLA_STRATEGIES';

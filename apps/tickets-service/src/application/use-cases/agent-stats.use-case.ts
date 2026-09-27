import { Injectable } from '@nestjs/common';
import { ApplicationService } from '@ticketera/patterns';
import { AgentWorkQueueSpec } from '../../domain/specifications';
import { TicketsRepository } from '../../infrastructure/repositories';

export interface AgentStatsQuery {
  agentId: string;
}

export interface AgentStatsView {
  agentId: string;
  workQueueSize: number;
  byStatus: Record<string, number>;
  avgResolutionMinutesLast30Days: number | null;
}

/**
 * Caso de uso: métricas de un agente. Todo se calcula con consultas agregadas en
 * Postgres — contar en Node significaría traer la cola completa para devolver
 * cuatro números.
 */
@Injectable()
export class AgentStatsUseCase extends ApplicationService<AgentStatsQuery, AgentStatsView> {
  constructor(private readonly tickets: TicketsRepository) {
    super();
  }

  async execute(query: AgentStatsQuery): Promise<AgentStatsView> {
    const queueSpec = new AgentWorkQueueSpec(query.agentId);

    const [workQueueSize, byStatus, avgResolutionMinutesLast30Days] = await Promise.all([
      this.tickets.count(queueSpec),
      this.tickets.countByStatus(queueSpec),
      this.tickets.averageResolutionMinutes(30, query.agentId),
    ]);

    return {
      agentId: query.agentId,
      workQueueSize,
      byStatus,
      avgResolutionMinutesLast30Days,
    };
  }
}

import { BusinessRuleViolationError, TicketCategory, TicketPriority, UserRole } from '@ticketera/common';
import { Ticket, User } from '@ticketera/database';
import { randomUUID } from 'node:crypto';
import { AgentWorkload, AssignmentContext } from './assignment.types';
import { AssignmentStrategyResolver } from './assignment-strategy.resolver';
import { EscalationAssignmentStrategy } from './escalation.strategy';
import { LeastLoadedAssignmentStrategy } from './least-loaded.strategy';
import { SkillBasedAssignmentStrategy } from './skill-based.strategy';

describe('AssignmentStrategyResolver', () => {
  const buildAgent = (overrides: Partial<User> = {}): User => {
    const agent = new User();
    agent.id = randomUUID();
    agent.email = `${overrides.fullName ?? 'agente'}@test.local`;
    agent.fullName = 'Agente';
    agent.role = UserRole.AGENT;
    agent.isActive = true;
    agent.skills = [];
    agent.maxConcurrentTickets = 10;
    return Object.assign(agent, overrides);
  };

  const workload = (agent: User, openTickets: number, overdueTickets = 0): AgentWorkload => ({
    agent,
    openTickets,
    overdueTickets,
  });

  const buildResolver = () =>
    new AssignmentStrategyResolver([
      new EscalationAssignmentStrategy(),
      new SkillBasedAssignmentStrategy(),
      new LeastLoadedAssignmentStrategy(),
    ]);

  const context = (
    candidates: AgentWorkload[],
    priority = TicketPriority.MEDIUM,
    category = TicketCategory.NETWORK,
  ): AssignmentContext => {
    const ticket = new Ticket();
    ticket.id = randomUUID();
    ticket.code = 'TCK-000001';
    ticket.priority = priority;
    ticket.category = category;
    return { ticket, candidates, category, priority };
  };

  it('un ticket crítico va al supervisor, no al especialista', async () => {
    const especialista = buildAgent({ skills: [TicketCategory.NETWORK] });
    const supervisor = buildAgent({ role: UserRole.SUPERVISOR });

    const { result, strategyName } = await buildResolver().assign(
      context(
        [workload(especialista, 0), workload(supervisor, 5)],
        TicketPriority.CRITICAL,
      ),
    );

    expect(strategyName).toBe('escalation');
    expect(result.assignee.id).toBe(supervisor.id);
  });

  it('prefiere al especialista de la categoría sobre el agente más libre', async () => {
    const especialista = buildAgent({ skills: [TicketCategory.NETWORK] });
    const libre = buildAgent();

    const { result, strategyName } = await buildResolver().assign(
      context([workload(especialista, 4), workload(libre, 0)]),
    );

    expect(strategyName).toBe('skill-based');
    expect(result.assignee.id).toBe(especialista.id);
  });

  it('entre especialistas elige al de menor carga', async () => {
    const cargado = buildAgent({ skills: [TicketCategory.NETWORK] });
    const liviano = buildAgent({ skills: [TicketCategory.NETWORK] });

    const { result } = await buildResolver().assign(
      context([workload(cargado, 7), workload(liviano, 2)]),
    );

    expect(result.assignee.id).toBe(liviano.id);
  });

  it('degrada a least-loaded cuando todos los especialistas están al límite', async () => {
    const especialistaTope = buildAgent({
      skills: [TicketCategory.NETWORK],
      maxConcurrentTickets: 3,
    });
    const generalista = buildAgent();

    const { result, strategyName } = await buildResolver().assign(
      context([workload(especialistaTope, 3), workload(generalista, 1)]),
    );

    expect(strategyName).toBe('least-loaded');
    expect(result.assignee.id).toBe(generalista.id);
  });

  it('asigna igual cuando todos superaron su capacidad', async () => {
    const a = buildAgent({ maxConcurrentTickets: 2 });
    const b = buildAgent({ maxConcurrentTickets: 2 });

    const { result } = await buildResolver().assign(
      context([workload(a, 9), workload(b, 4)]),
    );

    expect(result.assignee.id).toBe(b.id);
  });

  it('desempata por menos tickets vencidos', async () => {
    const conVencidos = buildAgent();
    const sinVencidos = buildAgent();

    const { result } = await buildResolver().assign(
      context([workload(conVencidos, 3, 2), workload(sinVencidos, 3, 0)]),
    );

    expect(result.assignee.id).toBe(sinVencidos.id);
  });

  it('falla explícitamente si no hay candidatos', async () => {
    await expect(buildResolver().assign(context([]))).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });

  it('la razón de la decisión queda registrada', async () => {
    const { result } = await buildResolver().assign(context([workload(buildAgent(), 3)]));

    expect(result.rationale).toContain('menor carga');
  });
});

import { TicketCategory, TicketPriority, TicketStatus } from '@ticketera/common';
import { Ticket } from '@ticketera/database';
import { CompositeSpecification, Specification } from '@ticketera/patterns';
import { SelectQueryBuilder } from 'typeorm';

/**
 * Specifications de Ticket.
 *
 * Cada regla de filtrado es una clase reutilizable y combinable, en vez de un
 * método de repositorio por combinación. Así `TicketsRepository` no crece con
 * cada pantalla nueva del frontend, y las reglas se pueden testear sin base de
 * datos usando `isSatisfiedBy`.
 *
 * Los parámetros SQL llevan sufijo único para poder componer dos instancias de
 * la misma specification sin que se sobreescriban entre sí.
 */

let paramSeq = 0;
const nextParam = (base: string): string => `${base}_${++paramSeq}`;

export class TicketByStatusSpec extends CompositeSpecification<Ticket> {
  constructor(private readonly statuses: TicketStatus[]) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    return this.statuses.includes(ticket.status);
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('statuses');
    return qb.andWhere(`${alias}.status IN (:...${p})`, { [p]: this.statuses });
  }
}

export class TicketByPrioritySpec extends CompositeSpecification<Ticket> {
  constructor(private readonly priorities: TicketPriority[]) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    return this.priorities.includes(ticket.priority);
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('priorities');
    return qb.andWhere(`${alias}.priority IN (:...${p})`, { [p]: this.priorities });
  }
}

export class TicketByCategorySpec extends CompositeSpecification<Ticket> {
  constructor(private readonly category: TicketCategory) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    return ticket.category === this.category;
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('category');
    return qb.andWhere(`${alias}.category = :${p}`, { [p]: this.category });
  }
}

export class TicketAssignedToSpec extends CompositeSpecification<Ticket> {
  constructor(private readonly assigneeId: string) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    return ticket.assigneeId === this.assigneeId;
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('assigneeId');
    return qb.andWhere(`${alias}.assigneeId = :${p}`, { [p]: this.assigneeId });
  }
}

export class TicketRequestedBySpec extends CompositeSpecification<Ticket> {
  constructor(private readonly requesterId: string) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    return ticket.requesterId === this.requesterId;
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('requesterId');
    return qb.andWhere(`${alias}.requesterId = :${p}`, { [p]: this.requesterId });
  }
}

export class UnassignedTicketSpec extends CompositeSpecification<Ticket> {
  isSatisfiedBy(ticket: Ticket): boolean {
    return ticket.assigneeId === null;
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    return qb.andWhere(`${alias}.assigneeId IS NULL`);
  }
}

/**
 * Tickets que ya vencieron su SLA y siguen sin resolverse.
 *
 * @param onlyUnmarked excluye los que ya tienen el incumplimiento registrado. El
 *   barrido periódico lo usa para que la consulta devuelva solo incumplimientos
 *   NUEVOS: sin esto traía el backlog acumulado completo en cada corrida y
 *   descartaba en memoria, con dos joins y sin techo.
 */
export class OverdueTicketSpec extends CompositeSpecification<Ticket> {
  constructor(
    private readonly now: Date = new Date(),
    private readonly onlyUnmarked = false,
  ) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    if (this.onlyUnmarked && ticket.slaBreached) return false;
    return ticket.isOverdue(this.now);
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('now');
    qb.andWhere(`${alias}.slaDueAt IS NOT NULL`)
      .andWhere(`${alias}.slaDueAt < :${p}`, { [p]: this.now })
      .andWhere(`${alias}.status NOT IN ('${TicketStatus.RESOLVED}', '${TicketStatus.CLOSED}')`);

    if (this.onlyUnmarked) qb.andWhere(`${alias}.slaBreached = false`);

    return qb;
  }
}

/** Vencimiento inminente: usado para alertar antes de incumplir, no después. */
export class TicketNearSlaBreachSpec extends CompositeSpecification<Ticket> {
  constructor(
    private readonly withinMinutes: number,
    private readonly now: Date = new Date(),
  ) {
    super();
  }

  private threshold(): Date {
    return new Date(this.now.getTime() + this.withinMinutes * 60_000);
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    if (!ticket.slaDueAt || ticket.isTerminal()) return false;
    return ticket.slaDueAt > this.now && ticket.slaDueAt <= this.threshold();
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const from = nextParam('slaFrom');
    const to = nextParam('slaTo');
    return qb
      .andWhere(`${alias}.slaDueAt IS NOT NULL`)
      .andWhere(`${alias}.slaDueAt > :${from}`, { [from]: this.now })
      .andWhere(`${alias}.slaDueAt <= :${to}`, { [to]: this.threshold() })
      .andWhere(`${alias}.status NOT IN ('${TicketStatus.RESOLVED}', '${TicketStatus.CLOSED}')`);
  }
}

/** Búsqueda de texto sobre título y descripción. */
export class TicketTextSearchSpec extends CompositeSpecification<Ticket> {
  constructor(private readonly term: string) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    const needle = this.term.toLowerCase();
    return (
      ticket.title.toLowerCase().includes(needle) ||
      ticket.description.toLowerCase().includes(needle) ||
      ticket.code.toLowerCase().includes(needle)
    );
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('term');
    // ILIKE con parámetro: el comodín va en el valor, nunca concatenado al SQL.
    //
    // Los comodines que escribe el usuario se escapan: buscar "%" debe encontrar
    // los tickets que contienen ese carácter, no devolver la tabla entera. No es
    // una vulnerabilidad (el valor está parametrizado), es un resultado incorrecto.
    const escaped = this.term.replace(/([\\%_])/g, String.raw`\$1`);
    const needle = `%${escaped}%`;
    return qb.andWhere(
      `(${alias}.title ILIKE :${p} OR ${alias}.description ILIKE :${p} OR ${alias}.code ILIKE :${p})`,
      { [p]: needle },
    );
  }
}

/**
 * Rango de creación, con cualquiera de los dos extremos opcional: `desde` sin
 * `hasta` es un filtro legítimo ("todo lo posterior a"), y descartarlo en silencio
 * era peor que rechazarlo.
 */
export class TicketCreatedBetweenSpec extends CompositeSpecification<Ticket> {
  constructor(
    private readonly from?: Date,
    private readonly to?: Date,
  ) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    if (this.from && ticket.createdAt < this.from) return false;
    if (this.to && ticket.createdAt > this.to) return false;
    return true;
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    if (this.from) {
      const p = nextParam('createdFrom');
      qb.andWhere(`${alias}.createdAt >= :${p}`, { [p]: this.from });
    }
    if (this.to) {
      const p = nextParam('createdTo');
      qb.andWhere(`${alias}.createdAt <= :${p}`, { [p]: this.to });
    }
    return qb;
  }
}

export class TicketByTagSpec extends CompositeSpecification<Ticket> {
  constructor(private readonly tag: string) {
    super();
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    return ticket.tags.includes(this.tag);
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    const p = nextParam('tag');
    return qb.andWhere(`:${p} = ANY(${alias}.tags)`, { [p]: this.tag });
  }
}

/** Specification neutra: punto de partida para componer filtros opcionales. */
export class AllTicketsSpec extends CompositeSpecification<Ticket> {
  isSatisfiedBy(): boolean {
    return true;
  }

  applyTo(qb: SelectQueryBuilder<Ticket>): SelectQueryBuilder<Ticket> {
    return qb;
  }
}

/**
 * Cola de trabajo de un agente: lo que tiene asignado y todavía le exige acción.
 * Es una specification "de negocio" compuesta de primitivas — el lugar correcto
 * para nombrar un concepto del dominio en vez de repetir la combinación.
 */
export class AgentWorkQueueSpec extends CompositeSpecification<Ticket> {
  private readonly inner: Specification<Ticket>;

  constructor(agentId: string) {
    super();
    // Se construye en el cuerpo del constructor, no como field initializer:
    // así no depende del orden de inicialización de parameter properties.
    this.inner = new TicketAssignedToSpec(agentId).and(
      new TicketByStatusSpec([
        TicketStatus.ASSIGNED,
        TicketStatus.IN_PROGRESS,
        TicketStatus.WAITING_CUSTOMER,
      ]),
    );
  }

  isSatisfiedBy(ticket: Ticket): boolean {
    return this.inner.isSatisfiedBy(ticket);
  }

  applyTo(qb: SelectQueryBuilder<Ticket>, alias: string): SelectQueryBuilder<Ticket> {
    return this.inner.applyTo(qb, alias);
  }
}

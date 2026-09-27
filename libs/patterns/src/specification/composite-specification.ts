import { Brackets, EntityTarget, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { Specification } from './specification.interface';

/**
 * Base para toda Specification concreta: aporta la composición booleana
 * (and / or / not) para que cada regla concreta solo implemente su predicado.
 */
export abstract class CompositeSpecification<T extends ObjectLiteral> implements Specification<T> {
  abstract isSatisfiedBy(candidate: T): boolean;

  abstract applyTo(
    qb: SelectQueryBuilder<T>,
    alias: string,
  ): SelectQueryBuilder<T>;

  and(other: Specification<T>): Specification<T> {
    return new AndSpecification<T>(this, other);
  }

  or(other: Specification<T>): Specification<T> {
    return new OrSpecification<T>(this, other);
  }

  not(): Specification<T> {
    return new NotSpecification<T>(this);
  }
}

export class AndSpecification<T extends ObjectLiteral> extends CompositeSpecification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }

  applyTo(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
    this.left.applyTo(qb, alias);
    this.right.applyTo(qb, alias);
    return qb;
  }
}

export class OrSpecification<T extends ObjectLiteral> extends CompositeSpecification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }

  applyTo(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
    // Cada rama se construye sobre un QueryBuilder hijo para capturar su SQL
    // y sus parámetros sin ensuciar el WHERE del builder principal.
    const left = this.captureBranch(qb, alias, this.left);
    const right = this.captureBranch(qb, alias, this.right);

    if (!left && !right) return qb;
    if (!left) return qb.andWhere(right!.sql, right!.params);
    if (!right) return qb.andWhere(left.sql, left.params);

    return qb.andWhere(
      new Brackets((inner) => {
        inner.where(left.sql, left.params).orWhere(right.sql, right.params);
      }),
    );
  }

  private captureBranch(
    qb: SelectQueryBuilder<T>,
    alias: string,
    spec: Specification<T>,
  ): { sql: string; params: Record<string, unknown> } | null {
    const probe = qb.connection
      .createQueryBuilder()
      .select(`${alias}.id`)
      .from(qb.expressionMap.mainAlias!.metadata.target as EntityTarget<T>, alias);

    spec.applyTo(probe as unknown as SelectQueryBuilder<T>, alias);

    // TypeORM tipa `condition` como unión (string | operador | WhereClause[]) para
    // soportar su sintaxis de objeto, pero acá cada Specification concreta arma su
    // condición con `andWhere(sqlString, params)`: siempre es texto SQL.
    const where = probe.expressionMap.wheres
      .map((w) => `(${w.condition as string})`)
      .join(' AND ');

    if (!where) return null;
    return { sql: where, params: probe.getParameters() };
  }
}

export class NotSpecification<T extends ObjectLiteral> extends CompositeSpecification<T> {
  constructor(private readonly wrapped: Specification<T>) {
    super();
  }

  isSatisfiedBy(candidate: T): boolean {
    return !this.wrapped.isSatisfiedBy(candidate);
  }

  applyTo(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
    const probe = qb.connection
      .createQueryBuilder()
      .select(`${alias}.id`)
      .from(qb.expressionMap.mainAlias!.metadata.target as EntityTarget<T>, alias);

    this.wrapped.applyTo(probe as unknown as SelectQueryBuilder<T>, alias);

    // TypeORM tipa `condition` como unión (string | operador | WhereClause[]) para
    // soportar su sintaxis de objeto, pero acá cada Specification concreta arma su
    // condición con `andWhere(sqlString, params)`: siempre es texto SQL.
    const where = probe.expressionMap.wheres
      .map((w) => `(${w.condition as string})`)
      .join(' AND ');

    if (!where) return qb;
    return qb.andWhere(`NOT (${where})`, probe.getParameters());
  }
}

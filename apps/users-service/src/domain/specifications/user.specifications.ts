import { UserRole } from '@ticketera/common';
import { User } from '@ticketera/database';
import { CompositeSpecification } from '@ticketera/patterns';
import { SelectQueryBuilder } from 'typeorm';

/** Specifications de User: mismas reglas del lado de tickets, otro agregado. */

let seq = 0;
const param = (base: string): string => `${base}_u${++seq}`;

export class UserByEmailSpec extends CompositeSpecification<User> {
  constructor(private readonly email: string) {
    super();
  }

  isSatisfiedBy(user: User): boolean {
    return user.email.toLowerCase() === this.email.toLowerCase();
  }

  applyTo(qb: SelectQueryBuilder<User>, alias: string): SelectQueryBuilder<User> {
    const p = param('email');
    // Se compara en minúsculas en ambos lados: el email es case-insensitive en
    // la práctica y un usuario no debería fallar el login por escribir mayúsculas.
    return qb.andWhere(`LOWER(${alias}.email) = :${p}`, { [p]: this.email.toLowerCase() });
  }
}

export class UserByIdsSpec extends CompositeSpecification<User> {
  constructor(private readonly ids: string[]) {
    super();
  }

  isSatisfiedBy(user: User): boolean {
    return this.ids.includes(user.id);
  }

  applyTo(qb: SelectQueryBuilder<User>, alias: string): SelectQueryBuilder<User> {
    const p = param('ids');
    return qb.andWhere(`${alias}.id IN (:...${p})`, { [p]: this.ids });
  }
}

export class UserByRolesSpec extends CompositeSpecification<User> {
  constructor(private readonly roles: UserRole[]) {
    super();
  }

  isSatisfiedBy(user: User): boolean {
    return this.roles.includes(user.role);
  }

  applyTo(qb: SelectQueryBuilder<User>, alias: string): SelectQueryBuilder<User> {
    const p = param('roles');
    return qb.andWhere(`${alias}.role IN (:...${p})`, { [p]: this.roles });
  }
}

export class ActiveUserSpec extends CompositeSpecification<User> {
  constructor(private readonly active = true) {
    super();
  }

  isSatisfiedBy(user: User): boolean {
    return user.isActive === this.active;
  }

  applyTo(qb: SelectQueryBuilder<User>, alias: string): SelectQueryBuilder<User> {
    const p = param('isActive');
    return qb.andWhere(`${alias}.isActive = :${p}`, { [p]: this.active });
  }
}

export class UserWithSkillSpec extends CompositeSpecification<User> {
  constructor(private readonly skill: string) {
    super();
  }

  isSatisfiedBy(user: User): boolean {
    return user.hasSkill(this.skill);
  }

  applyTo(qb: SelectQueryBuilder<User>, alias: string): SelectQueryBuilder<User> {
    const p = param('skill');
    return qb.andWhere(`:${p} = ANY(${alias}.skills)`, { [p]: this.skill });
  }
}

export class AllUsersSpec extends CompositeSpecification<User> {
  isSatisfiedBy(): boolean {
    return true;
  }

  applyTo(qb: SelectQueryBuilder<User>): SelectQueryBuilder<User> {
    return qb;
  }
}

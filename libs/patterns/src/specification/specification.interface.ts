import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Patrón Specification.
 *
 * Una Specification encapsula una regla de negocio consultable en un objeto
 * de primera clase, con dos capacidades:
 *
 *  - `isSatisfiedBy`: evalúa la regla en memoria (útil en dominio y tests).
 *  - `applyTo`: traduce la misma regla a SQL vía QueryBuilder, para que la
 *    base de datos filtre y no traigamos filas de más.
 *
 * Mantener ambas implementaciones en la misma clase es lo que evita que la
 * regla se duplique entre el dominio y la capa de persistencia.
 */
export interface Specification<T extends ObjectLiteral> {
  isSatisfiedBy(candidate: T): boolean;

  /**
   * Aplica la regla al QueryBuilder. `alias` es el alias de la entidad raíz.
   * Debe usar parámetros nombrados únicos para poder combinarse con otras
   * specifications sin colisiones.
   */
  applyTo(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T>;

  and(other: Specification<T>): Specification<T>;
  or(other: Specification<T>): Specification<T>;
  not(): Specification<T>;
}

import { ObjectLiteral } from 'typeorm';
import { Specification } from '../specification';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageRequest {
  page: number;
  pageSize: number;
  orderBy?: string;
  order?: 'ASC' | 'DESC';
}

/**
 * Patrón Repository.
 *
 * Contrato de persistencia expresado en términos del dominio, sin filtrar
 * TypeORM, SQL ni nombres de columna hacia arriba. La capa de aplicación
 * depende de esta interfaz; el módulo decide qué implementación inyecta, lo que
 * permite sustituirla en tests por una en memoria sin tocar los casos de uso.
 *
 * Las consultas se expresan con Specification, no con un método por filtro:
 * eso evita el repositorio de 40 métodos `findByEstadoYPrioridadYAgente`.
 */
export interface Repository<TEntity extends ObjectLiteral, TId = string> {
  findById(id: TId): Promise<TEntity | null>;
  findOne(spec: Specification<TEntity>): Promise<TEntity | null>;
  findAll(spec: Specification<TEntity>): Promise<TEntity[]>;
  findPaged(spec: Specification<TEntity>, page: PageRequest): Promise<Page<TEntity>>;
  count(spec: Specification<TEntity>): Promise<number>;
  exists(spec: Specification<TEntity>): Promise<boolean>;
  save(entity: TEntity): Promise<TEntity>;
  remove(entity: TEntity): Promise<void>;
}

/**
 * Unit of Work: agrupa varias escrituras de repositorios en una transacción.
 * Los eventos de dominio se publican fuera de `runInTransaction`, nunca dentro.
 */
export interface UnitOfWork {
  runInTransaction<T>(work: (ctx: TransactionContext) => Promise<T>): Promise<T>;
}

/**
 * Handle de la transacción en curso.
 *
 * `manager` está tipado como `unknown` a propósito: `libs/patterns` no depende de
 * TypeORM, y tiparlo como `EntityManager` acoplaría el contrato a un ORM. La
 * implementación concreta (`TypeOrmTransactionContext`) lo refina, y es esa la que
 * inyectan los casos de uso.
 */
export interface TransactionContext {
  readonly id: string;
  readonly manager: unknown;
  getRepository<T>(token: unknown): T;
}

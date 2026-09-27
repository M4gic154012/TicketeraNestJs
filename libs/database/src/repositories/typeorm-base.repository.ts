import {
  Page,
  PageRequest,
  Repository as RepositoryContract,
  Specification,
} from '@ticketera/patterns';
import {
  EntityTarget,
  ObjectLiteral,
  Repository as OrmRepository,
  SelectQueryBuilder,
} from 'typeorm';

/**
 * Implementación TypeORM del contrato Repository, parametrizada por entidad.
 *
 * Traduce Specifications a SQL en la base: `findAll(spec)` filtra en Postgres,
 * no en Node. Si filtráramos en memoria, `spec.isSatisfiedBy` sobre una tabla
 * de cientos de miles de tickets traería todo a la aplicación.
 */
export abstract class TypeOrmBaseRepository<TEntity extends ObjectLiteral>
  implements RepositoryContract<TEntity>
{
  protected constructor(
    protected readonly orm: OrmRepository<TEntity>,
    /** Alias de la entidad raíz en los QueryBuilder. Lo usan las Specifications. */
    protected readonly alias: string,
  ) {}

  /** Relaciones que se cargan por defecto en las lecturas de un solo agregado. */
  protected get defaultRelations(): string[] {
    return [];
  }

  /** Columnas por las que se permite ordenar. Whitelist: `orderBy` viene del cliente. */
  protected abstract get sortableColumns(): string[];

  protected abstract get defaultSortColumn(): string;

  async findById(id: string): Promise<TEntity | null> {
    const qb = this.baseQuery();
    return qb.where(`${this.alias}.id = :id`, { id }).getOne();
  }

  async findOne(spec: Specification<TEntity>): Promise<TEntity | null> {
    return spec.applyTo(this.baseQuery(), this.alias).getOne();
  }

  async findAll(spec: Specification<TEntity>): Promise<TEntity[]> {
    return spec.applyTo(this.baseQuery(), this.alias).getMany();
  }

  async findPaged(spec: Specification<TEntity>, page: PageRequest): Promise<Page<TEntity>> {
    const qb = spec.applyTo(this.baseQuery(), this.alias);

    const orderBy = this.resolveSortColumn(page.orderBy);
    qb.orderBy(`${this.alias}.${orderBy}`, page.order ?? 'DESC')
      // Desempate estable por id: sin él, dos filas con el mismo valor de orden
      // pueden repetirse o saltarse entre páginas.
      .addOrderBy(`${this.alias}.id`, 'ASC')
      .skip((page.page - 1) * page.pageSize)
      .take(page.pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: page.page, pageSize: page.pageSize };
  }

  async count(spec: Specification<TEntity>): Promise<number> {
    // Sin joins de lectura: para contar solo importa el WHERE.
    const qb = this.orm.createQueryBuilder(this.alias);
    return spec.applyTo(qb, this.alias).getCount();
  }

  async exists(spec: Specification<TEntity>): Promise<boolean> {
    const qb = this.orm.createQueryBuilder(this.alias).select(`${this.alias}.id`).limit(1);
    return (await spec.applyTo(qb, this.alias).getRawOne()) !== undefined;
  }

  async save(entity: TEntity): Promise<TEntity> {
    return this.orm.save(entity);
  }

  async remove(entity: TEntity): Promise<void> {
    await this.orm.remove(entity);
  }

  protected baseQuery(): SelectQueryBuilder<TEntity> {
    const qb = this.orm.createQueryBuilder(this.alias);
    for (const relation of this.defaultRelations) {
      qb.leftJoinAndSelect(`${this.alias}.${relation}`, relation);
    }
    return qb;
  }

  /**
   * Nunca interpolar `orderBy` sin validar: es entrada del cliente y llega
   * directo a la cláusula ORDER BY, o sea, inyección SQL.
   */
  protected resolveSortColumn(requested?: string): string {
    if (requested && this.sortableColumns.includes(requested)) return requested;
    return this.defaultSortColumn;
  }

  protected target(): EntityTarget<TEntity> {
    return this.orm.target;
  }
}

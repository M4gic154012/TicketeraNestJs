import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSubjectRequest, TypeOrmBaseRepository } from '@ticketera/database';
import { EntityManager, Repository as OrmRepository } from 'typeorm';

/**
 * Log de solo inserción + una consulta por FK: no hace falta Specification acá
 * (no hay un filtro de atributos que combinar), a diferencia de `UsersRepository`.
 */
@Injectable()
export class DataSubjectRequestsRepository extends TypeOrmBaseRepository<DataSubjectRequest> {
  constructor(@InjectRepository(DataSubjectRequest) orm: OrmRepository<DataSubjectRequest>) {
    super(orm, 'dsr');
  }

  protected get sortableColumns(): string[] {
    return ['createdAt'];
  }

  protected get defaultSortColumn(): string {
    return 'createdAt';
  }

  async record(entry: Partial<DataSubjectRequest>): Promise<DataSubjectRequest> {
    return this.orm.save(this.orm.create(entry));
  }

  /**
   * Igual que `record`, pero dentro de la transacción del Unit of Work: el
   * asiento de auditoría tiene que confirmarse en el mismo commit que la
   * mutación del usuario que registra, no después.
   */
  async recordWithManager(
    entry: Partial<DataSubjectRequest>,
    manager: EntityManager,
  ): Promise<DataSubjectRequest> {
    return manager.save(DataSubjectRequest, manager.create(DataSubjectRequest, entry));
  }

  async findBySubject(subjectUserId: string): Promise<DataSubjectRequest[]> {
    return this.orm.find({ where: { subjectUserId }, order: { createdAt: 'DESC' } });
  }
}

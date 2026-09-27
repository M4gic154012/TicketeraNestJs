import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TypeOrmBaseRepository, User } from '@ticketera/database';
import { EntityManager, Repository as OrmRepository } from 'typeorm';
import { UserByEmailSpec } from '../../domain/specifications';

@Injectable()
export class UsersRepository extends TypeOrmBaseRepository<User> {
  constructor(@InjectRepository(User) orm: OrmRepository<User>) {
    super(orm, 'user');
  }

  protected get sortableColumns(): string[] {
    return ['fullName', 'email', 'role', 'createdAt'];
  }

  protected get defaultSortColumn(): string {
    return 'fullName';
  }

  /**
   * Carga el usuario incluyendo el passwordHash, que está marcado
   * `select: false`. Es el único método que lo trae, y solo lo usa el caso de
   * uso de validación de credenciales.
   */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    const qb = this.orm.createQueryBuilder('user').addSelect('user.passwordHash');
    return new UserByEmailSpec(email).applyTo(qb, 'user').getOne();
  }

  async emailExists(email: string): Promise<boolean> {
    return this.exists(new UserByEmailSpec(email));
  }

  /**
   * Igual que `save`, pero dentro de la transacción del Unit of Work: la usan
   * los casos de uso ARCO que además insertan el asiento de auditoría en
   * `data_subject_requests` — las dos escrituras deben confirmarse juntas o
   * ninguna, porque la segunda es la evidencia de que la primera ocurrió.
   */
  async saveWithManager(user: User, manager: EntityManager): Promise<User> {
    return manager.save(User, user);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { TransactionContext, UnitOfWork } from '@ticketera/patterns';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Contexto de transacción con el `EntityManager` ya tipado.
 *
 * Existe para que los casos de uso no tengan que escribir
 * `(ctx as unknown as { manager: EntityManager }).manager`, que era ruido y
 * además silenciaba al compilador en el punto exacto donde importa acertar.
 */
export interface TypeOrmTransactionContext extends TransactionContext {
  readonly manager: EntityManager;
}

/**
 * Unit of Work sobre una transacción de TypeORM.
 *
 * El contexto expone el EntityManager transaccional para que los repositorios
 * que participan escriban en la MISMA transacción. Publicar eventos de dominio
 * es responsabilidad del llamador, después del commit.
 */
@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  private readonly logger = new Logger(TypeOrmUnitOfWork.name);

  constructor(private readonly dataSource: DataSource) {}

  async runInTransaction<T>(work: (ctx: TypeOrmTransactionContext) => Promise<T>): Promise<T> {
    const id = randomUUID();

    return this.dataSource.transaction(async (manager: EntityManager) => {
      const ctx: TypeOrmTransactionContext = {
        id,
        manager,
        getRepository: <R>(token: unknown) => manager.getRepository(token as never) as unknown as R,
      };

      this.logger.debug(`Transacción ${id} iniciada`);
      const result = await work(ctx);
      this.logger.debug(`Transacción ${id} lista para commit`);
      return result;
    });
  }
}

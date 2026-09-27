import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Notification, TypeOrmBaseRepository } from '@ticketera/database';
import { IsNull, Repository as OrmRepository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

@Injectable()
export class NotificationsRepository extends TypeOrmBaseRepository<Notification> {
  constructor(@InjectRepository(Notification) orm: OrmRepository<Notification>) {
    super(orm, 'notification');
  }

  protected get sortableColumns(): string[] {
    return ['createdAt', 'sentAt', 'channel'];
  }

  protected get defaultSortColumn(): string {
    return 'createdAt';
  }

  /**
   * Inserta ignorando duplicados por (eventId, recipientId, channel).
   *
   * Es la defensa de idempotencia del Observer: el transporte puede reentregar
   * un evento, y el usuario no debe recibir dos veces el mismo aviso.
   *
   * @returns las notificaciones efectivamente insertadas.
   */
  async insertIgnoringDuplicates(notifications: Notification[]): Promise<Notification[]> {
    if (notifications.length === 0) return [];

    const result = await this.orm
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values(notifications as QueryDeepPartialEntity<Notification>[])
      .orIgnore()
      .returning('id')
      .execute();

    const insertedIds = new Set((result.raw as { id: string }[]).map((row) => row.id));
    return notifications.filter((n) => insertedIds.has(n.id));
  }

  async findForUser(
    recipientId: string,
    onlyUnread: boolean,
    limit: number,
  ): Promise<Notification[]> {
    return this.orm.find({
      where: {
        recipientId,
        ...(onlyUnread ? { readAt: IsNull() } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Marca como leídas solo las del propio destinatario: el recipientId va en el
   * WHERE para que un id ajeno no permita tocar la bandeja de otro usuario.
   */
  async markAsRead(recipientId: string, notificationIds: string[]): Promise<number> {
    if (notificationIds.length === 0) return 0;

    const result = await this.orm
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: () => 'NOW()' })
      .where('recipientId = :recipientId', { recipientId })
      .andWhere('id IN (:...ids)', { ids: notificationIds })
      .andWhere('readAt IS NULL')
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Borra notificaciones LEÍDAS más viejas que `days`, hasta `limit` por llamada.
   *
   * El subselect con LIMIT acota el lote: un DELETE masivo sostiene un lock largo
   * y genera un pico de WAL que degrada al resto de la base.
   *
   * @returns cuántas filas borró, para que el llamador sepa si quedan más.
   */
  async deleteReadOlderThan(days: number, limit: number): Promise<number> {
    const result = await this.orm.query(
      `DELETE FROM notifications
       WHERE id IN (
         SELECT id FROM notifications
         WHERE "readAt" IS NOT NULL
           AND "readAt" < NOW() - make_interval(days => $1)
         LIMIT $2
       )`,
      [days, limit],
    );

    // node-postgres devuelve [rows, rowCount] para un DELETE sin RETURNING.
    return Array.isArray(result) ? (Number(result[1]) || 0) : 0;
  }

  async countUnread(recipientId: string): Promise<number> {
    return this.orm.count({ where: { recipientId, readAt: IsNull() } });
  }

  /**
   * Total de notificaciones del destinatario, sin el `take` de `findForUser`.
   * Existe para que el llamante pueda distinguir "esto es todo" de "esto es
   * lo primero que entró bajo el límite" — el dossier ARCO lo usa para no
   * reportar como completo un historial que en realidad se truncó.
   */
  async countAll(recipientId: string, onlyUnread: boolean): Promise<number> {
    return this.orm.count({
      where: { recipientId, ...(onlyUnread ? { readAt: IsNull() } : {}) },
    });
  }
}

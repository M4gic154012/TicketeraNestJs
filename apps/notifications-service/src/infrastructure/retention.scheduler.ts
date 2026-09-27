import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsRepository } from './repositories';

/**
 * Retención de notificaciones.
 *
 * `notifications` es la tabla que crece más rápido del sistema (una fila por
 * evento × destinatario × canal) y nada la acotaba. Definir la retención con
 * miles de filas cuesta mucho menos que con millones, y sin ella la bandeja
 * histórica se vuelve la consulta más lenta del sistema.
 *
 * Solo borra notificaciones ya leídas: una sin leer sigue siendo información
 * pendiente para su destinatario, por vieja que sea.
 */
@Injectable()
export class NotificationRetentionScheduler {
  private readonly logger = new Logger(NotificationRetentionScheduler.name);
  private running = false;

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'notification-retention' })
  async purge(): Promise<void> {
    // Con réplicas, solo una instancia purga: ver la nota en SlaMonitorScheduler.
    // `get<boolean>`: el esquema lo coacciona, comparar contra 'false' no funcionaba.
    if (this.config.get<boolean>('SCHEDULER_ENABLED') === false) return;
    if (this.running) return;

    const days = this.config.get<number>('NOTIFICATION_RETENTION_DAYS') ?? 90;
    this.running = true;

    try {
      // Se borra por lotes: un DELETE de millones de filas mantiene un lock largo
      // y genera un pico de WAL que afecta al resto de la base.
      let totalDeleted = 0;
      let deleted: number;

      do {
        deleted = await this.notifications.deleteReadOlderThan(days, 5_000);
        totalDeleted += deleted;
      } while (deleted > 0);

      if (totalDeleted > 0) {
        this.logger.log(`Retención: ${totalDeleted} notificaciones leídas eliminadas`);
      }
    } catch (error) {
      this.logger.error(`La purga de notificaciones falló: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

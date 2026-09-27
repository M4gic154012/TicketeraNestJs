import { NotificationChannel } from '@ticketera/common';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('notifications')
@Index('ix_notifications_recipient_created', ['recipientId', 'createdAt'])
// Idempotencia del Observer: un mismo evento reentregado no debe generar dos
// notificaciones al mismo destinatario por el mismo canal.
@Index('uq_notifications_event_recipient', ['eventId', 'recipientId', 'channel'], {
  unique: true,
})
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  eventId!: string;

  @Column({ type: 'varchar', length: 80 })
  eventName!: string;

  @Column({ type: 'uuid' })
  recipientId!: string;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel!: NotificationChannel;

  @Column({ type: 'varchar', length: 200 })
  subject!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  /** Último error de entrega, para diagnosticar el canal sin revisar logs. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  lastError!: string | null;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  markSent(): void {
    this.sentAt = new Date();
    this.lastError = null;
    this.attempts += 1;
  }

  markFailed(error: string): void {
    this.lastError = error.slice(0, 500);
    this.attempts += 1;
  }
}

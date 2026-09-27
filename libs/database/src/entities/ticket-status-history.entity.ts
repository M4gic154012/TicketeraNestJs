import { TicketStatus } from '@ticketera/common';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';

/**
 * Bitácora de cambios de estado. Es append-only: la usan las métricas de
 * tiempo de resolución y la auditoría, así que no se actualiza ni se borra.
 */
@Entity('ticket_status_history')
@Index('ix_status_history_ticket', ['ticketId', 'changedAt'])
export class TicketStatusHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  ticketId!: string;

  @ManyToOne(() => Ticket, (ticket) => ticket.statusHistory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket?: Ticket;

  // enumName explícito: comparte el tipo con `tickets.status` a propósito. Sin
  // nombrarlo, TypeORM cree que necesita un tipo propio y `migration:generate`
  // produce un ALTER TYPE ... RENAME que reescribe la tabla completa.
  @Column({ type: 'enum', enum: TicketStatus, enumName: 'tickets_status_enum', nullable: true })
  fromStatus!: TicketStatus | null;

  @Column({ type: 'enum', enum: TicketStatus, enumName: 'tickets_status_enum' })
  toStatus!: TicketStatus;

  @Column({ type: 'uuid', nullable: true })
  changedById!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  changedAt!: Date;
}

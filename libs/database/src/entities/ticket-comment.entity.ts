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
import { User } from './user.entity';

@Entity('ticket_comments')
@Index('ix_comments_ticket_created', ['ticketId', 'createdAt'])
export class TicketComment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  ticketId!: string;

  @ManyToOne(() => Ticket, (ticket) => ticket.comments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket?: Ticket;

  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'authorId' })
  author?: User;

  @Column({ type: 'text' })
  body!: string;

  /**
   * Nota interna entre agentes: nunca debe exponerse al solicitante. El BFF es
   * responsable de filtrarla según el rol de quien consulta.
   */
  @Column({ type: 'boolean', default: false })
  isInternal!: boolean;

  /** Message-ID del correo del que salió este comentario, si vino por esa vía. */
  @Column({ type: 'varchar', length: 998, nullable: true })
  sourceMessageId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

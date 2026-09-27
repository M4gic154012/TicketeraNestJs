import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum EmailProcessingOutcome {
  TICKET_CREATED = 'TICKET_CREATED',
  COMMENT_ADDED = 'COMMENT_ADDED',
  DISCARDED = 'DISCARDED',
  FAILED = 'FAILED',
}

/**
 * Bitácora de correos procesados por la ingesta.
 *
 * Cumple dos funciones que conviene no separar:
 *
 * 1. **Idempotencia.** El `messageId` es único: si el poller relee un correo —porque
 *    el proceso murió antes de marcarlo como leído, o porque alguien lo marcó como no
 *    leído a mano— el segundo intento choca contra el índice y no crea un ticket
 *    duplicado. Es el mismo mecanismo que usa `notifications`.
 *
 * 2. **Auditoría de los descartes.** Es lo que permite responder "¿por qué el correo
 *    de Fulano no generó ticket?" sin revisar logs. Con un buzón que recibe salida de
 *    crontab, esa pregunta se hace seguido, y `discardReason` la contesta.
 */
@Entity('processed_emails')
@Index('ix_processed_emails_received', ['receivedAt'])
@Index('ix_processed_emails_outcome', ['outcome', 'receivedAt'])
export class ProcessedEmail {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * `Message-ID` de la cabecera del correo. Único: es la clave de idempotencia.
   * 998 caracteres es el largo máximo de una línea de cabecera (RFC 5322).
   */
  @Index('uq_processed_emails_message_id', { unique: true })
  @Column({ type: 'varchar', length: 998 })
  messageId!: string;

  @Column({ type: 'varchar', length: 255 })
  fromAddress!: string;

  @Column({ type: 'varchar', length: 500 })
  subject!: string;

  @Column({ type: 'enum', enum: EmailProcessingOutcome })
  outcome!: EmailProcessingOutcome;

  /** Siempre poblado: explica el resultado, sea ticket, comentario o descarte. */
  @Column({ type: 'varchar', length: 300 })
  reason!: string;

  /** Ticket creado o comentado. Null en descartes y fallos. */
  @Column({ type: 'uuid', nullable: true })
  ticketId!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  ticketCode!: string | null;

  @Column({ type: 'timestamptz' })
  receivedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  processedAt!: Date;
}

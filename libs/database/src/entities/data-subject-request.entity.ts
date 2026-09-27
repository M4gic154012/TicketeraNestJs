import { DataSubjectRequestStatus, DataSubjectRequestType } from '@ticketera/common';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Rastro auditable de un derecho ARCO/portabilidad/bloqueo ejercido.
 *
 * La ley exige poder acreditar qué se atendió, cuándo, por qué motivo y a
 * solicitud de quién — sin esta tabla, una anonimización o un bloqueo no deja
 * ningún registro distinguible de un UPDATE cualquiera de `users`.
 */
@Entity('data_subject_requests')
@Index('ix_dsr_subject_created', ['subjectUserId', 'createdAt'])
export class DataSubjectRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** El titular de los datos sobre los que se ejerció el derecho. */
  @Column({ type: 'uuid' })
  subjectUserId!: string;

  /** Quién lo ejerció: el propio titular, o un ADMIN en representación. */
  @Column({ type: 'uuid' })
  requestedByUserId!: string;

  @Column({ type: 'enum', enum: DataSubjectRequestType })
  type!: DataSubjectRequestType;

  @Column({
    type: 'enum',
    enum: DataSubjectRequestStatus,
    default: DataSubjectRequestStatus.RECEIVED,
  })
  status!: DataSubjectRequestStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}

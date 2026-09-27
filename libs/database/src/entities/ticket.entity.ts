import {
  ALLOWED_STATUS_TRANSITIONS,
  BusinessRuleViolationError,
  InvalidStateTransitionError,
  TicketAssignedEvent,
  TicketCategory,
  TicketCommentedEvent,
  TicketCreatedEvent,
  TicketPriority,
  TicketResolvedEvent,
  TicketSlaBreachedEvent,
  TicketStatus,
  TicketSourceChannel,
  TicketStatusChangedEvent,
} from '@ticketera/common';
import { AggregateRoot } from '@ticketera/patterns';
import { randomUUID } from 'node:crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { TicketComment } from './ticket-comment.entity';
import { TicketStatusHistory } from './ticket-status-history.entity';
import { User } from './user.entity';

/**
 * Agregado Ticket. Modelo rico: las reglas de transición, de SLA y de asignación
 * viven acá, no en el servicio. El servicio orquesta; el ticket decide si el
 * cambio es legal.
 *
 * Es a la vez entidad TypeORM y agregado de dominio — un modelo único en lugar
 * de entidad de persistencia + entidad de dominio + mapper. El costo es que el
 * dominio conoce los decoradores de TypeORM; el beneficio es que no hay dos
 * representaciones que se desincronicen. Ver CLAUDE.md.
 */
@Entity('tickets')
// Índices orientados a las consultas reales de la bandeja de trabajo:
// filtrar por estado+prioridad, ver la cola de un agente, y barrer SLA vencidos.
@Index('ix_tickets_status_priority', ['status', 'priority'])
@Index('ix_tickets_assignee_status', ['assigneeId', 'status'])
// Los índices declarados acá son los que TypeORM puede expresar. Los GIN/trgm y
// los funcionales viven SOLO en las migraciones: ver la nota sobre
// `migration:generate` en CLAUDE.md antes de tocar esto.
@Index('ix_tickets_sla_due', ['slaDueAt'], {
  where: `"slaDueAt" IS NOT NULL AND "slaBreached" = false AND "status" NOT IN ('RESOLVED', 'CLOSED')`,
})
@Index('ix_tickets_requester', ['requesterId', 'createdAt'])
export class Ticket extends AggregateRoot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Código legible para humanos (TCK-000123). Es lo que cita el usuario. */
  @Index('uq_tickets_code', { unique: true })
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
  status!: TicketStatus;

  @Column({ type: 'enum', enum: TicketPriority, default: TicketPriority.MEDIUM })
  priority!: TicketPriority;

  @Column({ type: 'enum', enum: TicketCategory, default: TicketCategory.OTHER })
  category!: TicketCategory;

  @Column({ type: 'uuid' })
  requesterId!: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requesterId' })
  requester?: User;

  @Column({ type: 'uuid', nullable: true })
  assigneeId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigneeId' })
  assignee?: User | null;

  /** Fecha límite de atención según la política de SLA de su prioridad. */
  @Column({ type: 'timestamptz', nullable: true })
  slaDueAt!: Date | null;

  /** Se marca una sola vez, para no notificar el mismo incumplimiento en loop. */
  @Column({ type: 'boolean', default: false })
  slaBreached!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  firstResponseAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  /** Por dónde entró el ticket. Un ticket de correo se responde por correo. */
  @Column({ type: 'enum', enum: TicketSourceChannel, default: TicketSourceChannel.WEB })
  sourceChannel!: TicketSourceChannel;

  /** Message-ID del correo que lo originó, para encadenar las respuestas. */
  @Column({ type: 'varchar', length: 998, nullable: true })
  sourceMessageId!: string | null;

  // Relaciones de solo lectura desde el agregado: se cargan para las vistas de
  // detalle, pero el agregado nunca reasigna estos arrays (ver addComment).
  @OneToMany(() => TicketComment, (comment) => comment.ticket)
  comments?: TicketComment[];

  // Sin cascade: los asientos nuevos se persisten explícitamente. El cascade de
  // TypeORM deriva la FK de la relación cargada, y al abrir el ticket con un
  // QueryBuilder con lock la colección no viene cargada — el INSERT terminaba
  // con ticketId nulo. Ver `pullNewStatusHistory`.
  @OneToMany(() => TicketStatusHistory, (history) => history.ticket)
  statusHistory?: TicketStatusHistory[];

  /**
   * Asientos de historial generados en esta unidad de trabajo y todavía sin
   * persistir. No es una columna: vive solo en memoria, igual que los eventos
   * de dominio, y lo drena el repositorio dentro de la transacción.
   */
  private pendingStatusHistory: TicketStatusHistory[] = [];

  /**
   * Bloqueo optimista. Dos supervisores asignando el mismo ticket a la vez
   * provocan que el segundo save falle en lugar de sobrescribir al primero.
   */
  @VersionColumn()
  version!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  // ---------------------------------------------------------------------------
  // Comportamiento de dominio
  // ---------------------------------------------------------------------------

  /**
   * Registra el evento de creación. Existe como método público porque quien
   * construye el agregado es TicketFactory, no el propio constructor, y `record`
   * es protegido. No lo llames desde ningún otro lugar: un ticket solo nace una vez.
   */
  recordCreation(event: TicketCreatedEvent): void {
    this.record(event);
  }

  /**
   * Asiento inicial del historial (null -> OPEN). Lo invoca TicketFactory al
   * construir el ticket, por la misma razón que `recordCreation`.
   */
  recordInitialHistory(createdById: string): void {
    const history = new TicketStatusHistory();
    history.id = randomUUID();
    history.ticketId = this.id;
    history.fromStatus = null;
    history.toStatus = TicketStatus.OPEN;
    history.changedById = createdById;
    history.reason = 'Ticket creado';
    history.changedAt = new Date();

    this.pendingStatusHistory.push(history);
  }

  assignTo(assignee: User, strategyName: string): void {
    if (this.isClosed()) {
      throw new BusinessRuleViolationError('No se puede asignar un ticket cerrado', {
        ticketId: this.id,
        status: this.status,
      });
    }
    if (!assignee.isAgent()) {
      throw new BusinessRuleViolationError(
        'Solo un agente puede tomar tickets',
        { userId: assignee.id, role: assignee.role },
      );
    }
    if (!assignee.isActive) {
      throw new BusinessRuleViolationError('El agente está inactivo', { userId: assignee.id });
    }

    const previousAssigneeId = this.assigneeId;
    this.assigneeId = assignee.id;
    this.assignee = assignee;

    if (this.status === TicketStatus.OPEN) {
      this.applyStatus(TicketStatus.ASSIGNED, assignee.id, 'Asignación automática');
    }

    this.record(
      new TicketAssignedEvent(this.id, {
        code: this.code,
        assigneeId: assignee.id,
        previousAssigneeId,
        assignedByStrategy: strategyName,
      }),
    );
  }

  changeStatus(next: TicketStatus, changedById: string, reason?: string): void {
    const allowed = ALLOWED_STATUS_TRANSITIONS[this.status];
    if (!allowed.includes(next)) {
      throw new InvalidStateTransitionError(this.status, next, allowed);
    }
    if (next === TicketStatus.IN_PROGRESS && !this.assigneeId) {
      throw new BusinessRuleViolationError(
        'Un ticket sin agente asignado no puede pasar a EN PROGRESO',
        { ticketId: this.id },
      );
    }

    const from = this.status;
    this.applyStatus(next, changedById, reason ?? null);

    this.record(
      new TicketStatusChangedEvent(this.id, {
        code: this.code,
        fromStatus: from,
        toStatus: next,
        changedById,
        // El consumidor decide a quién avisar: sin estos ids notificaba a quien
        // hizo el cambio en lugar de a quien espera el ticket.
        requesterId: this.requesterId,
        assigneeId: this.assigneeId,
        reason: reason ?? null,
      }),
    );

    if (next === TicketStatus.RESOLVED) {
      this.record(
        new TicketResolvedEvent(this.id, {
          code: this.code,
          requesterId: this.requesterId,
          resolvedById: changedById,
          resolutionMinutes: this.resolutionMinutes() ?? 0,
          withinSla: !this.slaBreached,
        }),
      );
    }
  }

  addComment(comment: TicketComment): void {
    if (this.isClosed()) {
      throw new BusinessRuleViolationError('No se puede comentar un ticket cerrado', {
        ticketId: this.id,
      });
    }

    // No se toca `this.comments`: al guardar el ticket, TypeORM sincronizaría la
    // colección y desvincularía los comentarios que no estén en el array. El
    // comentario lo persiste el caso de uso por separado.

    // La primera respuesta pública de un agente marca el tiempo de primera
    // respuesta, métrica de SLA distinta al tiempo de resolución.
    if (!this.firstResponseAt && !comment.isInternal && comment.authorId !== this.requesterId) {
      this.firstResponseAt = new Date();
    }

    this.record(
      new TicketCommentedEvent(this.id, {
        code: this.code,
        commentId: comment.id,
        authorId: comment.authorId,
        isInternal: comment.isInternal,
        excerpt: comment.body.slice(0, 140),
        // El consumidor decide a quién avisar: sin estos ids notificaba al propio
        // autor del comentario en lugar de a la otra parte de la conversación.
        requesterId: this.requesterId,
        assigneeId: this.assigneeId,
      }),
    );
  }

  markSlaBreached(now: Date = new Date()): void {
    if (this.slaBreached || !this.slaDueAt || this.isTerminal()) return;
    if (now <= this.slaDueAt) return;

    this.slaBreached = true;
    const minutesOverdue = Math.floor((now.getTime() - this.slaDueAt.getTime()) / 60_000);

    this.record(
      new TicketSlaBreachedEvent(this.id, {
        code: this.code,
        assigneeId: this.assigneeId,
        slaDueAt: this.slaDueAt.toISOString(),
        minutesOverdue,
      }),
    );
  }

  /** Drena los asientos de historial pendientes para que el repositorio los inserte. */
  pullNewStatusHistory(): TicketStatusHistory[] {
    const pending = this.pendingStatusHistory;
    this.pendingStatusHistory = [];
    return pending;
  }

  isClosed(): boolean {
    return this.status === TicketStatus.CLOSED;
  }

  /** Terminal = ya no consume SLA. */
  isTerminal(): boolean {
    return this.status === TicketStatus.CLOSED || this.status === TicketStatus.RESOLVED;
  }

  isOverdue(now: Date = new Date()): boolean {
    return !!this.slaDueAt && !this.isTerminal() && now > this.slaDueAt;
  }

  resolutionMinutes(): number | null {
    const end = this.resolvedAt ?? this.closedAt;
    if (!end) return null;
    return Math.floor((end.getTime() - this.createdAt.getTime()) / 60_000);
  }

  private applyStatus(next: TicketStatus, changedById: string, reason: string | null): void {
    const history = new TicketStatusHistory();
    history.id = randomUUID();
    history.ticketId = this.id;
    history.fromStatus = this.status;
    history.toStatus = next;
    history.changedById = changedById;
    history.reason = reason;
    history.changedAt = new Date();

    this.pendingStatusHistory.push(history);
    this.status = next;

    if (next === TicketStatus.RESOLVED) this.resolvedAt = new Date();
    if (next === TicketStatus.CLOSED) this.closedAt = new Date();
  }
}

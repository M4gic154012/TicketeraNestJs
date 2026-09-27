import { UserRole } from '@ticketera/common';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Único e indexado: es la credencial de login y el lookup más frecuente. */
  // La unicidad real la impone un índice FUNCIONAL sobre LOWER(email), creado en
  // la migración PerformanceAndIntegrityFixes. TypeORM no puede expresar índices
  // sobre expresiones, así que acá no se declara ninguno: declarar uno sobre la
  // columna cruda haría creer que existe una garantía case-sensitive que no está.
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 120 })
  fullName!: string;

  /**
   * `select: false` para que el hash no salga en un `find` accidental y no
   * termine serializado en una respuesta.
   */
  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.REQUESTER })
  role!: UserRole;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  /**
   * Capacidad máxima de tickets simultáneos del agente. La usa la estrategia de
   * asignación por carga; null significa sin límite definido.
   */
  @Column({ type: 'int', nullable: true })
  maxConcurrentTickets!: number | null;

  /** Categorías en las que el agente es especialista, para la asignación. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  skills!: string[];

  @OneToMany(() => Ticket, (ticket) => ticket.requester)
  requestedTickets?: Ticket[];

  @OneToMany(() => Ticket, (ticket) => ticket.assignee)
  assignedTickets?: Ticket[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /** Cancelación (ARCO) atendida: la fila nunca se borra (FK RESTRICT), se anonimiza. */
  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt!: Date | null;

  /**
   * Bloqueo temporal del tratamiento de sus datos, pedido por el titular
   * (oposición) o por el responsable mientras evalúa una disputa. Es
   * intencionalmente independiente de `isActive`, que es una bandera de
   * negocio (capacidad de operar como agente), no de privacidad.
   */
  @Column({ type: 'timestamptz', nullable: true })
  privacyBlockedAt!: Date | null;

  // Igualado a 1000 con `data_subject_requests.reason` y con el `@MaxLength`
  // de los DTOs que lo alimentan (`PrivacyBlockDto`, `OppositionRequestDto`):
  // ver migración `WidenPrivacyBlockReason1758100000000`.
  @Column({ type: 'varchar', length: 1000, nullable: true })
  privacyBlockReason!: string | null;

  isAgent(): boolean {
    return (
      this.role === UserRole.AGENT ||
      this.role === UserRole.SUPERVISOR ||
      this.role === UserRole.ADMIN
    );
  }

  hasSkill(skill: string): boolean {
    return this.skills.includes(skill);
  }

  isAnonymized(): boolean {
    return this.anonymizedAt !== null;
  }

  isPrivacyBlocked(): boolean {
    return this.privacyBlockedAt !== null;
  }

  /**
   * Reemplaza los campos identificables por placeholders estables e
   * irreversibles. Idempotente: una segunda solicitud de cancelación del
   * mismo titular no debe fallar ni volver a mutar el estado.
   *
   * `unusablePasswordHash` se genera fuera del agregado (hashear es async y
   * requiere `bcrypt`, igual que en `UserFactory`) pero la decisión de qué
   * campos tocar es una invariante del agregado, no del caso de uso.
   */
  anonymize(unusablePasswordHash: string): void {
    if (this.isAnonymized()) return;
    this.email = `eliminado-${this.id}@anonimizado.local`;
    this.fullName = 'Usuario eliminado';
    this.passwordHash = unusablePasswordHash;
    this.department = null;
    this.skills = [];
    this.maxConcurrentTickets = null;
    this.isActive = false;
    this.anonymizedAt = new Date();
  }

  blockPrivacy(reason: string): void {
    this.privacyBlockedAt = new Date();
    this.privacyBlockReason = reason;
  }

  unblockPrivacy(): void {
    this.privacyBlockedAt = null;
    this.privacyBlockReason = null;
  }
}

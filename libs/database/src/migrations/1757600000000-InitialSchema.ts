import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema inicial.
 *
 * Escrita a mano y no generada: incluye la secuencia de códigos de ticket, los
 * índices parciales y el índice de texto que `synchronize` no produce.
 */
export class InitialSchema1757600000000 implements MigrationInterface {
  name = 'InitialSchema1757600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    // pg_trgm acelera las búsquedas con ILIKE '%texto%', que sin índice de
    // trigramas obligan a un scan secuencial de la tabla completa.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    await queryRunner.query(`
      CREATE TYPE "users_role_enum" AS ENUM ('REQUESTER', 'AGENT', 'SUPERVISOR', 'ADMIN')
    `);
    await queryRunner.query(`
      CREATE TYPE "tickets_status_enum" AS ENUM (
        'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "tickets_priority_enum" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    `);
    await queryRunner.query(`
      CREATE TYPE "tickets_category_enum" AS ENUM (
        'HARDWARE', 'SOFTWARE', 'NETWORK', 'ACCESS', 'OTHER'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "notifications_channel_enum" AS ENUM ('EMAIL', 'IN_APP', 'WEBHOOK')
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(255) NOT NULL,
        "fullName" character varying(120) NOT NULL,
        "passwordHash" character varying(255) NOT NULL,
        "role" "users_role_enum" NOT NULL DEFAULT 'REQUESTER',
        "department" character varying(120),
        "isActive" boolean NOT NULL DEFAULT true,
        "maxConcurrentTickets" integer,
        "skills" text array NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`);
    // Índice parcial: las consultas de agentes siempre piden activos, así que el
    // índice solo indexa esas filas y queda mucho más chico.
    await queryRunner.query(`
      CREATE INDEX "ix_users_active_role" ON "users" ("role") WHERE "isActive" = true
    `);
    await queryRunner.query(`CREATE INDEX "ix_users_skills" ON "users" USING GIN ("skills")`);

    // Secuencia para el código legible: asignar códigos con MAX()+1 rompe ante
    // dos creaciones concurrentes.
    await queryRunner.query(`CREATE SEQUENCE "ticket_code_seq" START 1 INCREMENT 1`);

    await queryRunner.query(`
      CREATE TABLE "tickets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying(20) NOT NULL,
        "title" character varying(200) NOT NULL,
        "description" text NOT NULL,
        "status" "tickets_status_enum" NOT NULL DEFAULT 'OPEN',
        "priority" "tickets_priority_enum" NOT NULL DEFAULT 'MEDIUM',
        "category" "tickets_category_enum" NOT NULL DEFAULT 'OTHER',
        "requesterId" uuid NOT NULL,
        "assigneeId" uuid,
        "slaDueAt" TIMESTAMP WITH TIME ZONE,
        "slaBreached" boolean NOT NULL DEFAULT false,
        "firstResponseAt" TIMESTAMP WITH TIME ZONE,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "closedAt" TIMESTAMP WITH TIME ZONE,
        "tags" text array NOT NULL DEFAULT '{}',
        "version" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tickets" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tickets_requester" FOREIGN KEY ("requesterId")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_tickets_assignee" FOREIGN KEY ("assigneeId")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_tickets_code" ON "tickets" ("code")`);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_status_priority" ON "tickets" ("status", "priority")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_assignee_status" ON "tickets" ("assigneeId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_requester" ON "tickets" ("requesterId", "createdAt")
    `);
    // El barrido de SLA solo mira tickets no terminales con vencimiento: el
    // índice parcial evita recorrer el histórico cerrado en cada corrida.
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_sla_due" ON "tickets" ("slaDueAt")
      WHERE "slaDueAt" IS NOT NULL AND "status" NOT IN ('RESOLVED', 'CLOSED')
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_unassigned" ON "tickets" ("priority", "createdAt")
      WHERE "assigneeId" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_title_trgm" ON "tickets" USING GIN ("title" gin_trgm_ops)
    `);
    await queryRunner.query(`CREATE INDEX "ix_tickets_tags" ON "tickets" USING GIN ("tags")`);

    await queryRunner.query(`
      CREATE TABLE "ticket_comments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ticketId" uuid NOT NULL,
        "authorId" uuid NOT NULL,
        "body" text NOT NULL,
        "isInternal" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ticket_comments" PRIMARY KEY ("id"),
        CONSTRAINT "fk_comments_ticket" FOREIGN KEY ("ticketId")
          REFERENCES "tickets"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_comments_author" FOREIGN KEY ("authorId")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_comments_ticket_created" ON "ticket_comments" ("ticketId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "ticket_status_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ticketId" uuid NOT NULL,
        "fromStatus" "tickets_status_enum",
        "toStatus" "tickets_status_enum" NOT NULL,
        "changedById" uuid,
        "reason" character varying(500),
        "changedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ticket_status_history" PRIMARY KEY ("id"),
        CONSTRAINT "fk_history_ticket" FOREIGN KEY ("ticketId")
          REFERENCES "tickets"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_status_history_ticket" ON "ticket_status_history" ("ticketId", "changedAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventId" uuid NOT NULL,
        "eventName" character varying(80) NOT NULL,
        "recipientId" uuid NOT NULL,
        "channel" "notifications_channel_enum" NOT NULL,
        "subject" character varying(200) NOT NULL,
        "body" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "sentAt" TIMESTAMP WITH TIME ZONE,
        "readAt" TIMESTAMP WITH TIME ZONE,
        "lastError" character varying(500),
        "attempts" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notifications" PRIMARY KEY ("id")
      )
    `);
    // Clave de idempotencia del Observer: un evento reentregado no duplica el
    // aviso al mismo destinatario por el mismo canal.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_notifications_event_recipient"
      ON "notifications" ("eventId", "recipientId", "channel")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_notifications_recipient_unread" ON "notifications" ("recipientId", "createdAt")
      WHERE "readAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket_status_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tickets"`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "ticket_code_seq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notifications_channel_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tickets_category_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tickets_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tickets_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum"`);
  }
}

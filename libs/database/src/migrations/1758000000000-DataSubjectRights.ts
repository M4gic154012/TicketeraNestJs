import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Derechos ARCO + portabilidad (Ley 21.719).
 *
 * Agrega a `users` el estado de anonimización (cancelación) y de bloqueo de
 * privacidad (oposición/bloqueo temporal) — distinto de `isActive`, que es una
 * bandera de negocio y no de privacidad. Agrega `data_subject_requests` como
 * rastro auditable de qué derecho se ejerció, cuándo, por qué motivo y a
 * solicitud de quién: sin esta tabla, una anonimización o un bloqueo no deja
 * ningún registro distinguible de un UPDATE cualquiera.
 */
export class DataSubjectRights1758000000000 implements MigrationInterface {
  name = 'DataSubjectRights1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "anonymizedAt" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "privacyBlockedAt" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "privacyBlockReason" character varying(500)
    `);

    await queryRunner.query(`
      CREATE TYPE "data_subject_request_type_enum" AS ENUM (
        'ACCESS', 'RECTIFICATION', 'CANCELLATION', 'OPPOSITION', 'PORTABILITY',
        'BLOCK', 'UNBLOCK'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "data_subject_request_status_enum" AS ENUM (
        'RECEIVED', 'COMPLETED', 'REJECTED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "data_subject_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "subjectUserId" uuid NOT NULL,
        "requestedByUserId" uuid NOT NULL,
        "type" "data_subject_request_type_enum" NOT NULL,
        "status" "data_subject_request_status_enum" NOT NULL DEFAULT 'RECEIVED',
        "reason" character varying(1000),
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "pk_data_subject_requests" PRIMARY KEY ("id"),
        CONSTRAINT "fk_dsr_subject" FOREIGN KEY ("subjectUserId")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_dsr_requested_by" FOREIGN KEY ("requestedByUserId")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // Historial de un titular, más reciente primero: es la consulta que sirve
    // el dossier de acceso y cualquier vista administrativa de seguimiento.
    await queryRunner.query(`
      CREATE INDEX "ix_dsr_subject_created"
      ON "data_subject_requests" ("subjectUserId", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_dsr_subject_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "data_subject_requests"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "data_subject_request_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "data_subject_request_type_enum"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "privacyBlockReason"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "privacyBlockedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "anonymizedAt"`);
  }
}

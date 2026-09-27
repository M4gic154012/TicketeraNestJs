import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ingesta de tickets por correo.
 *
 * Agrega la bitácora de correos procesados (que es a la vez el mecanismo de
 * idempotencia) y el origen del ticket, para poder distinguir lo que entró por la web
 * de lo que entró por el buzón.
 */
export class EmailIngestion1757800000000 implements MigrationInterface {
  name = 'EmailIngestion1757800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "processed_emails_outcome_enum" AS ENUM (
        'TICKET_CREATED', 'COMMENT_ADDED', 'DISCARDED', 'FAILED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "processed_emails" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "messageId" character varying(998) NOT NULL,
        "fromAddress" character varying(255) NOT NULL,
        "subject" character varying(500) NOT NULL,
        "outcome" "processed_emails_outcome_enum" NOT NULL,
        "reason" character varying(300) NOT NULL,
        "ticketId" uuid,
        "ticketCode" character varying(20),
        "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "processedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_processed_emails" PRIMARY KEY ("id"),
        CONSTRAINT "fk_processed_emails_ticket" FOREIGN KEY ("ticketId")
          REFERENCES "tickets"("id") ON DELETE SET NULL
      )
    `);

    // La idempotencia de la ingesta. Un correo releído —porque el proceso murió antes
    // de marcarlo como leído, o porque alguien lo marcó como no leído— choca acá en
    // lugar de crear un segundo ticket.
    //
    // El índice es sobre md5 y no sobre la columna: un Message-ID puede llegar a 998
    // caracteres y el límite de una entrada de índice btree en Postgres es ~2704 bytes,
    // que con texto multibyte se puede superar. El hash es de largo fijo.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_processed_emails_message_id"
      ON "processed_emails" (md5("messageId"))
    `);

    await queryRunner.query(`
      CREATE INDEX "ix_processed_emails_received" ON "processed_emails" ("receivedAt" DESC)
    `);
    // Para la pregunta frecuente: "¿qué se descartó y por qué?"
    await queryRunner.query(`
      CREATE INDEX "ix_processed_emails_outcome"
      ON "processed_emails" ("outcome", "receivedAt" DESC)
    `);

    // --- Origen del ticket -------------------------------------------------
    await queryRunner.query(`
      CREATE TYPE "tickets_source_channel_enum" AS ENUM ('WEB', 'EMAIL')
    `);
    await queryRunner.query(`
      ALTER TABLE "tickets"
      ADD COLUMN "sourceChannel" "tickets_source_channel_enum" NOT NULL DEFAULT 'WEB'
    `);
    // Message-ID del correo que originó el ticket: permite encadenar las respuestas
    // por cabecera además de por el código en el asunto.
    await queryRunner.query(`
      ALTER TABLE "tickets" ADD COLUMN "sourceMessageId" character varying(998)
    `);
    await queryRunner.query(`
      ALTER TABLE "ticket_comments" ADD COLUMN "sourceMessageId" character varying(998)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ticket_comments" DROP COLUMN IF EXISTS "sourceMessageId"`);
    await queryRunner.query(`ALTER TABLE "tickets" DROP COLUMN IF EXISTS "sourceMessageId"`);
    await queryRunner.query(`ALTER TABLE "tickets" DROP COLUMN IF EXISTS "sourceChannel"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "tickets_source_channel_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "processed_emails"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "processed_emails_outcome_enum"`);
  }
}

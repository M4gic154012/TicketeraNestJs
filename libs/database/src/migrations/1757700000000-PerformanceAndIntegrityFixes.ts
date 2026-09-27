import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correcciones de índices e integridad surgidas de la revisión de base de datos.
 *
 * Cada cambio responde a un plan de ejecución medido con EXPLAIN, no a intuición.
 */
export class PerformanceAndIntegrityFixes1757700000000 implements MigrationInterface {
  name = 'PerformanceAndIntegrityFixes1757700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. El login no usaba su índice -------------------------------------
    // La aplicación compara `LOWER(email) = :email`, y un índice sobre `email`
    // no sirve para una expresión: el plan era Seq Scan en la consulta más
    // frecuente del sistema. El índice funcional además garantiza en el motor la
    // unicidad case-insensitive que hoy solo sostiene el código: sin él, un
    // script puede insertar 'Admin@x' y 'admin@x' como dos cuentas distintas.
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_email"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email_lower" ON "users" (LOWER("email"))`,
    );

    // --- 2. La búsqueda de texto no podía usar el índice trgm ---------------
    // El WHERE es (title ILIKE ... OR description ILIKE ... OR code ILIKE ...).
    // Para armar un BitmapOr, Postgres necesita que TODAS las ramas sean
    // indexables; faltaba el trgm de description, así que el plan era Seq Scan
    // y el índice de title solo pagaba costo en cada escritura.
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_description_trgm"
      ON "tickets" USING GIN ("description" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_code_trgm" ON "tickets" USING GIN ("code" gin_trgm_ops)
    `);

    // --- 3. El barrido de SLA recorría el backlog acumulado -----------------
    // Sumar `slaBreached = false` al índice parcial lo deja con solo las filas
    // candidatas: el barrido pasa a costar O(incumplimientos nuevos) en lugar de
    // O(todos los vencidos abiertos), que crece de forma monótona.
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_tickets_sla_due"`);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_sla_due" ON "tickets" ("slaDueAt")
      WHERE "slaDueAt" IS NOT NULL
        AND "slaBreached" = false
        AND "status" NOT IN ('RESOLVED', 'CLOSED')
    `);

    // --- 4. La métrica de resolución hacía Seq Scan -------------------------
    // Índice parcial: solo los tickets ya terminados tienen fecha de cierre.
    //
    // El predicado del WHERE es EXACTAMENTE el de la consulta
    // (`COALESCE(...) IS NOT NULL`) y no la forma equivalente con OR: Postgres
    // solo usa un índice parcial si puede probar que el predicado de la consulta
    // implica el del índice, y con un OR no lo deduce — medido con EXPLAIN.
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_resolution" ON "tickets" (COALESCE("resolvedAt", "closedAt"))
      WHERE COALESCE("resolvedAt", "closedAt") IS NOT NULL
    `);

    // --- 5. El listado por defecto ordenaba sin índice ---------------------
    // `findPaged` ordena por createdAt DESC; con paginación por offset, la página
    // N cuesta cada vez más si hay que ordenar la tabla entera.
    await queryRunner.query(`CREATE INDEX "ix_tickets_created_at" ON "tickets" ("createdAt" DESC)`);

    // --- 6. La bandeja completa de notificaciones no tenía índice ----------
    // El parcial existente solo cubre las no leídas. La bandeja histórica
    // (recipientId + ORDER BY createdAt DESC) quedaba en Seq Scan + Sort, en la
    // tabla que más rápido crece del sistema.
    await queryRunner.query(`
      CREATE INDEX "ix_notifications_recipient_created"
      ON "notifications" ("recipientId", "createdAt" DESC)
    `);

    // --- 7. `version` sin DEFAULT ------------------------------------------
    // TypeORM siempre manda el valor, pero cualquier INSERT a mano (carga de
    // datos, fixture, migración) fallaba con violación de NOT NULL.
    await queryRunner.query(`ALTER TABLE "tickets" ALTER COLUMN "version" SET DEFAULT 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tickets" ALTER COLUMN "version" DROP DEFAULT`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_notifications_recipient_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_tickets_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_tickets_resolution"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_tickets_sla_due"`);
    await queryRunner.query(`
      CREATE INDEX "ix_tickets_sla_due" ON "tickets" ("slaDueAt")
      WHERE "slaDueAt" IS NOT NULL AND "status" NOT IN ('RESOLVED', 'CLOSED')
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "ix_tickets_code_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_tickets_description_trgm"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "uq_users_email_lower"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")`);
  }
}

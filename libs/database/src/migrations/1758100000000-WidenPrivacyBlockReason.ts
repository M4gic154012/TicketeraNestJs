import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `users.privacyBlockReason` quedó en `varchar(500)` en la migración de ARCO,
 * pero `PrivacyBlockDto.reason` y `OppositionRequestDto.reason` validan hasta
 * 1000 caracteres — y `RegisterOppositionUseCase` además le agrega el prefijo
 * `"Oposición: "` (11 caracteres) antes de guardarlo. Un titular que ejerce
 * oposición o bloqueo con un motivo largo, perfectamente válido según el DTO,
 * recibía un error de Postgres (`value too long for type character
 * varying(500)`) en vez de que su solicitud ARCO quedara registrada. Se
 * empareja con `data_subject_requests.reason`, que ya es `varchar(1000)`.
 */
export class WidenPrivacyBlockReason1758100000000 implements MigrationInterface {
  name = 'WidenPrivacyBlockReason1758100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "privacyBlockReason" TYPE character varying(1000)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "privacyBlockReason" TYPE character varying(500)
    `);
  }
}

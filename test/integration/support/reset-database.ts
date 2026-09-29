import { DataSource } from 'typeorm';

/**
 * Tablas de dominio, en un orden que no importa porque `CASCADE` se encarga de
 * las FKs. `RESTART IDENTITY` no aplica a los uuid, pero sí a `ticket_code_seq`
 * si alguna vez se trunca `tickets` sin volver a sembrar la secuencia — no es
 * el caso hoy, los tests arman el código a mano.
 */
const DOMAIN_TABLES = [
  'ticket_comments',
  'ticket_status_history',
  'data_subject_requests',
  'processed_emails',
  'notifications',
  'tickets',
  'users',
];

/**
 * Deja la base en blanco entre tests. Se usa `TRUNCATE ... CASCADE` en vez de
 * borrar fila por fila: con miles de filas de una corrida anterior, un DELETE
 * fila por fila es notablemente más lento y no resetea las secuencias.
 */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  const tables = DOMAIN_TABLES.map((t) => `"${t}"`).join(', ');
  await dataSource.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

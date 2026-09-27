import { IncomingEmail } from '../../classification';

/**
 * Patrón Strategy aplicado al proveedor de correo.
 *
 * El dominio no sabe si los correos vienen de IMAP, de la API de Gmail o de archivos
 * `.eml` en disco. Eso permite dos cosas concretas: probar la ingesta completa sin
 * tener el buzón institucional creado todavía, y cambiar de IMAP a la API de Gmail
 * más adelante sin tocar la clasificación ni los casos de uso.
 */
export interface MailboxAdapter {
  readonly name: string;

  /** ¿Está configurado y disponible para usarse? */
  isAvailable(): boolean;

  /**
   * Trae los correos sin procesar, hasta `limit`.
   *
   * No los marca como leídos: eso lo hace `acknowledge` recién cuando la ingesta
   * terminó bien. Si el proceso muere a mitad de camino, el correo sigue pendiente y
   * se reprocesa — y la idempotencia por `Message-ID` evita el ticket duplicado.
   */
  fetchPending(limit: number): Promise<IncomingEmail[]>;

  /** Marca el correo como procesado en el buzón (leído y/o archivado). */
  acknowledge(messageId: string): Promise<void>;

  /** Verifica la conexión. Lo usa el arranque para fallar temprano y con claridad. */
  verifyConnection(): Promise<void>;
}

export const MAILBOX_ADAPTER = 'MAILBOX_ADAPTER';

/** `mailparser` da `references` como string suelto cuando hay una sola, o array si hay varias. */
export function normalizeReferences(references: string | string[] | undefined): string[] {
  if (Array.isArray(references)) return references;
  return references ? [references] : [];
}

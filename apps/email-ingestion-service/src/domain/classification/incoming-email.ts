/**
 * Un correo recibido, ya parseado y normalizado por el adaptador de buzón.
 *
 * Es independiente del proveedor: IMAP, Gmail API o un archivo `.eml` de prueba
 * producen esta misma forma, así que el dominio no sabe de dónde vino.
 */
export interface IncomingEmail {
  /** `Message-ID` de la cabecera. Es la clave de idempotencia. */
  messageId: string;
  from: { address: string; name?: string };
  to: string[];
  subject: string;
  /** Cuerpo en texto plano, todavía sin limpiar firmas ni texto citado. */
  text: string;
  html?: string;
  receivedAt: Date;
  /** `In-Reply-To` y `References`: encadenan la respuesta a un correo anterior. */
  inReplyTo?: string;
  references: string[];
  /** Cabeceras crudas que necesita la clasificación (en minúsculas). */
  headers: Record<string, string>;
  attachmentCount: number;
}

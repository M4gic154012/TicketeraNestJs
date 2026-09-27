/** Qué hacer con un correo entrante. */
export enum EmailDisposition {
  /** Crear un ticket nuevo. */
  CREATE_TICKET = 'CREATE_TICKET',
  /** Agregar como comentario a un ticket existente (es una respuesta). */
  APPEND_COMMENT = 'APPEND_COMMENT',
  /** Ignorar. No es un requerimiento de una persona. */
  DISCARD = 'DISCARD',
}

export interface ClassificationResult {
  disposition: EmailDisposition;
  /** Motivo legible. Se guarda siempre, también en los descartes: es lo que
   *  permite auditar por qué un correo no generó ticket. */
  reason: string;
  /** Código del ticket al que pertenece la respuesta, si aplica. */
  ticketCode?: string;
}

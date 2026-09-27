import { Injectable } from '@nestjs/common';

/**
 * Deja el cuerpo del correo legible como descripción de un ticket.
 *
 * Sin esto, la descripción arrastra la firma institucional completa y toda la
 * conversación citada: el agente tiene que buscar el pedido real entre veinte líneas
 * de ruido, y la búsqueda de texto matchea contra firmas en lugar de contra el
 * problema.
 *
 * Trata la firma y la cita como cosas distintas, porque lo son:
 *
 * - **Firma**: lo que sigue nunca es parte del pedido. Se corta siempre.
 * - **Cita / reenvío**: lo que sigue puede ser TODO el contenido. Si el correo
 *   empieza con el encabezado de un reenvío, cortar ahí borraría el correo entero,
 *   así que en ese caso se quitan solo las líneas de encabezado y se conserva el resto.
 */
@Injectable()
export class EmailBodyCleaner {
  /**
   * Separadores de firma. `-- ` (con espacio final) es el estándar de facto
   * (RFC 3676); el resto son los que ponen los clientes en español e inglés.
   */
  private static readonly SIGNATURE_MARKERS = [
    /^--\s*$/m,
    /^-{2,}\s*$/m,
    /^_{5,}\s*$/m,
    /^Enviado desde mi /im,
    /^Sent from my /im,
    /^Obtener Outlook para /im,
    /^Get Outlook for /im,
  ];

  /**
   * Encabezados que abren texto citado o un reenvío.
   *
   * Las variantes con y sin tilde se contemplan en el propio patrón
   * (`escribi[oó]`): la gente escribe sin acentos, y con solo `escribió` una
   * respuesta real que decía "escribio" dejaba el encabezado de la cita dentro del
   * comentario del ticket — el mismo tipo de falla que tuvo la heurística de urgencia.
   *
   * La alternativa sería normalizar el texto antes de buscar, pero quitar diacríticos
   * cambia la longitud de la cadena y los índices dejarían de servir para cortar sobre
   * el original.
   */
  private static readonly QUOTE_MARKERS = [
    /^El .+ escribi[oó]:\s*$/im,
    /^On .+ wrote:\s*$/im,
    /^-{2,}\s*Mensaje original\s*-{2,}/im,
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^-{10,}\s*Forwarded message\s*-{10,}/im,
    /^-{2,}\s*Mensaje reenviado\s*-{2,}/im,
  ];

  /** Líneas de encabezado de correo que aparecen dentro de un reenvío. */
  private static readonly HEADER_LINE =
    /^\s*(De|From|Para|To|CC|CCO|BCC|Asunto|Subject|Fecha|Date|Enviado|Sent|Responder a|Reply-To)\s*:/i;

  clean(text: string): string {
    if (!text) return '';

    let body = text.replaceAll('\r\n', '\n');

    body = this.stripQuotedContent(body);
    body = this.stripSignature(body);

    // Las líneas que empiezan con ">" son texto citado sin encabezado.
    body = body
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('>'))
      .join('\n');

    return body.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Construye la descripción del ticket a partir del correo.
   *
   * Si el cuerpo queda vacío tras la limpieza —pasa cuando alguien escribe todo en el
   * asunto y manda el cuerpo con solo su firma— se usa el asunto. Un ticket sin
   * descripción no pasa la validación del dominio, y perder el pedido por eso sería
   * absurdo.
   */
  buildDescription(subject: string, text: string, senderAddress: string): string {
    const cleaned = this.clean(text);

    if (cleaned.length >= 10) return cleaned;

    const asunto = subject.trim();
    const detalle = cleaned.length > 0 ? `\n\nContenido recibido: ${cleaned}` : '';

    return asunto.length > 0
      ? `${asunto}\n\n(Correo de ${senderAddress}, sin cuerpo legible.)${detalle}`
      : `(Correo de ${senderAddress} sin asunto ni cuerpo legible.)${detalle}`;
  }

  /** La firma se corta siempre: lo que sigue nunca es parte del pedido. */
  private stripSignature(body: string): string {
    let cutIndex = body.length;

    for (const marker of EmailBodyCleaner.SIGNATURE_MARKERS) {
      const match = marker.exec(body);
      if (match && match.index < cutIndex) cutIndex = match.index;
    }

    return body.slice(0, cutIndex);
  }

  /**
   * Con la cita hay dos situaciones distintas:
   *
   * - Hay texto propio antes del encabezado: es una respuesta. Se corta ahí y se
   *   conserva lo que la persona escribió.
   * - El correo ARRANCA con el encabezado: es un reenvío puro y el contenido está
   *   después. Se quitan las líneas de encabezado y se conserva el cuerpo.
   */
  private stripQuotedContent(body: string): string {
    let earliest = body.length;

    for (const marker of EmailBodyCleaner.QUOTE_MARKERS) {
      const match = marker.exec(body);
      if (match && match.index < earliest) earliest = match.index;
    }

    if (earliest === body.length) return body;

    const ownText = body.slice(0, earliest).trim();
    if (ownText.length > 0) return body.slice(0, earliest);

    // Reenvío puro: se descartan el separador y las líneas de encabezado, y queda
    // el contenido reenviado.
    return body
      .slice(earliest)
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) return true;
        if (EmailBodyCleaner.HEADER_LINE.test(line)) return false;
        // El propio separador de guiones.
        return !EmailBodyCleaner.isDashSeparatorLine(trimmed);
      })
      .join('\n');
  }

  /**
   * Equivalente a `/^-{2,}.*-{2,}$/` pero sin backtracking: alcanza con que la
   * línea empiece y termine con dos guiones, ya que ese es el caso mínimo que
   * el regex original aceptaba (cualquier `k>=2`/`j>=2` mayor ya lo cubre `k=2, j=2`).
   * Escrito así evita el riesgo de rendimiento super-lineal del regex sobre
   * líneas largas de guiones.
   */
  private static isDashSeparatorLine(trimmed: string): boolean {
    return trimmed.length >= 4 && trimmed.startsWith('--') && trimmed.endsWith('--');
  }
}

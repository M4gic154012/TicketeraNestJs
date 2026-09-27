import { Injectable, Logger } from '@nestjs/common';
import { ClassificationResult, EmailDisposition } from './classification.types';
import { IncomingEmail } from './incoming-email';

/**
 * Decide qué hacer con un correo entrante.
 *
 * Es la pieza más importante de la ingesta, y el motivo es concreto: el buzón
 * institucional recibe **salida de crontab y monitoreo de servicios**, no solo
 * pedidos de personas. Cada uno de esos correos convertido en ticket es basura que
 * alguien tiene que limpiar a mano, y una bandeja con ruido hace que el equipo deje
 * de confiar en la herramienta antes de que empiece a servir.
 *
 * Por eso el filtro no es opcional aunque el buzón arranque limpio: es lo que hace
 * viable reenviar después `sistemas@ -> soporte@` sin que vuelva ese ruido.
 *
 * Falla hacia el DESCARTE cuando duda de que el remitente sea una persona, y hacia
 * el TICKET cuando duda del contenido: perder un pedido legítimo es peor que crear
 * un ticket de más, pero un remitente automático nunca es un pedido legítimo.
 */
@Injectable()
export class EmailClassifier {
  private readonly logger = new Logger(EmailClassifier.name);

  /**
   * Cabeceras que marcan un correo generado por una máquina. Están estandarizadas
   * (RFC 3834 para `auto-submitted`) y son la señal más confiable que existe:
   * mucho más que adivinar por el asunto.
   */
  private static readonly AUTOMATED_HEADERS = [
    'auto-submitted', // RFC 3834: cualquier valor distinto de "no"
    'x-auto-response-suppress',
    'x-autoreply',
    'x-autorespond',
    'precedence', // "bulk", "junk", "list"
    'list-id', // listas de correo
    'list-unsubscribe',
    'x-cron', // algunos wrappers de cron lo agregan
  ];

  /**
   * Remitentes que nunca son personas. Incluye las cuentas que usa cron en un
   * sistema Unix: la salida de un job llega como `root@host` o `cron@host`.
   */
  private static readonly AUTOMATED_SENDERS = [
    'root@',
    'cron@',
    'crond@',
    'daemon@',
    'mailer-daemon@',
    'postmaster@',
    'noreply@',
    'no-reply@',
    'nobody@',
    'bounce',
    'notifications@',
    'automated@',
    'monitoring@',
    'nagios@',
    'zabbix@',
    'prometheus@',
    'alertmanager@',
    'backup@',
    'jenkins@',
    'gitlab@',
    'github@',
  ];

  /**
   * Asuntos típicos de la salida de un crontab o de un sistema de monitoreo. Se
   * comparan sobre el asunto normalizado (sin tildes, en minúsculas).
   */
  private static readonly AUTOMATED_SUBJECTS = [
    'cron <',
    'cron job',
    'crontab',
    'anacron',
    'output from your job',
    'backup completed',
    'backup failed',
    'disk space',
    'certificate expir',
    'ssl certificate',
    'logrotate',
    'systemd',
    'unit failed',
    'health check',
    'monitoring alert',
    'nagios',
    'zabbix',
    'automatic reply',
    'respuesta automatica',
    'out of office',
    'fuera de la oficina',
    'undelivered mail',
    'delivery status notification',
    'mail delivery failed',
    'returned mail',
    'newsletter',
    'boletin',
  ];

  constructor(
    /** Dirección del propio buzón: leer lo que uno mismo envió es un bucle. */
    private readonly ownAddress: string,
    /** Dominios cuyos remitentes se aceptan como solicitantes. */
    private readonly allowedDomains: string[],
  ) {}

  classify(email: IncomingEmail): ClassificationResult {
    const from = email.from.address.toLowerCase();

    // --- 1. Prevención de bucles: lo primero de todo ---------------------
    // Si el sistema notifica desde el mismo buzón que lee, una respuesta
    // automática genera un ticket, que genera una notificación, que genera otro
    // ticket. Se corta antes de cualquier otra consideración.
    if (from === this.ownAddress.toLowerCase()) {
      return this.discard('El correo proviene del propio buzón (posible bucle)');
    }

    // --- 2. ¿Lo escribió una máquina? ------------------------------------
    const automatedHeader = this.findAutomatedHeader(email.headers);
    if (automatedHeader) {
      return this.discard(`Cabecera de correo automático: ${automatedHeader}`);
    }

    const automatedSender = EmailClassifier.AUTOMATED_SENDERS.find((s) => from.includes(s));
    if (automatedSender) {
      return this.discard(`Remitente automático (coincide con '${automatedSender}')`);
    }

    const normalizedSubject = EmailClassifier.normalize(email.subject);
    const automatedSubject = EmailClassifier.AUTOMATED_SUBJECTS.find((s) =>
      normalizedSubject.includes(s),
    );
    if (automatedSubject) {
      return this.discard(`Asunto de correo automático ('${automatedSubject}')`);
    }

    // --- 3. ¿Es una respuesta a un ticket que ya existe? -----------------
    // Se busca ANTES de decidir crear: una respuesta convertida en ticket nuevo
    // parte la conversación en dos y es el error más visible de una ingesta.
    const ticketCode = this.findTicketCode(email);
    if (ticketCode) {
      return {
        disposition: EmailDisposition.APPEND_COMMENT,
        reason: `Respuesta al ticket ${ticketCode}`,
        ticketCode,
      };
    }

    // --- 4. ¿El remitente pertenece a un dominio aceptado? ---------------
    if (!this.isAllowedDomain(from)) {
      return this.discard(`Dominio no autorizado: ${from.split('@')[1] ?? from}`);
    }

    // --- 5. ¿Tiene contenido suficiente? ---------------------------------
    // Un correo sin asunto ni cuerpo no describe nada; con adjuntos sí vale la
    // pena crearlo, porque el contenido puede estar ahí.
    if (email.subject.trim().length === 0 && email.text.trim().length === 0) {
      if (email.attachmentCount === 0) {
        return this.discard('Correo sin asunto ni cuerpo');
      }
    }

    return {
      disposition: EmailDisposition.CREATE_TICKET,
      reason: 'Correo de una persona en un dominio autorizado',
    };
  }

  private findAutomatedHeader(headers: Record<string, string>): string | null {
    for (const header of EmailClassifier.AUTOMATED_HEADERS) {
      const value = headers[header];
      if (value === undefined) continue;

      // `auto-submitted: no` es explícitamente un correo humano (RFC 3834).
      if (header === 'auto-submitted' && value.trim().toLowerCase() === 'no') continue;

      return `${header}: ${value.slice(0, 40)}`;
    }
    return null;
  }

  /**
   * Busca el código del ticket para encadenar una respuesta.
   *
   * Se prioriza el asunto (`[TCK-000123]`) sobre las cabeceras de threading porque
   * es lo que sobrevive cuando alguien reenvía el correo a mano o responde desde un
   * cliente que pierde `In-Reply-To`.
   */
  private findTicketCode(email: IncomingEmail): string | undefined {
    const fromSubject = /\bTCK-(\d{6})\b/i.exec(email.subject);
    if (fromSubject) return `TCK-${fromSubject[1]}`;

    // Como respaldo, el código puede venir en el Message-ID que generó el sistema.
    const threadIds = [email.inReplyTo, ...email.references].filter(Boolean).join(' ');
    const fromThread = /\bTCK-(\d{6})\b/i.exec(threadIds);
    return fromThread ? `TCK-${fromThread[1]}` : undefined;
  }

  private isAllowedDomain(address: string): boolean {
    if (this.allowedDomains.length === 0) return true;
    const domain = address.split('@')[1] ?? '';
    return this.allowedDomains.some(
      (allowed) => domain === allowed || domain.endsWith(`.${allowed}`),
    );
  }

  private discard(reason: string): ClassificationResult {
    this.logger.debug(`Descartado: ${reason}`);
    return { disposition: EmailDisposition.DISCARD, reason };
  }

  /** Sin tildes y en minúsculas: los asuntos automáticos vienen de cualquier locale. */
  private static normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }
}

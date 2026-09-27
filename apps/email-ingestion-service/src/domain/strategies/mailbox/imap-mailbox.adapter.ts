import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { IncomingEmail } from '../../classification';
import { MailboxAdapter, normalizeReferences } from './mailbox.types';

/**
 * Buzón por IMAP. Sirve para Google Workspace (`imap.gmail.com:993`), Microsoft 365
 * y cualquier servidor estándar.
 *
 * Para Google Workspace hace falta, del lado de la cuenta de `soporte@`:
 *  1. IMAP habilitado (Gmail → Configuración → Reenvío y correo POP/IMAP).
 *  2. Verificación en dos pasos activa.
 *  3. Una **contraseña de aplicación** de 16 caracteres — la contraseña normal de la
 *     cuenta no funciona para IMAP desde 2022.
 *
 * La alternativa institucional es la API de Gmail con cuenta de servicio y delegación
 * de dominio, que evita tener una contraseña en el entorno pero necesita que TI
 * autorice la delegación. Cuando eso esté, se suma otro adaptador con esta misma
 * interfaz y no cambia nada más.
 */
@Injectable()
export class ImapMailboxAdapter implements MailboxAdapter {
  readonly name = 'imap';
  private readonly logger = new Logger(ImapMailboxAdapter.name);

  private readonly host: string;
  private readonly port: number;
  private readonly user: string;
  private readonly password: string;
  private readonly mailbox: string;

  constructor(config: ConfigService) {
    this.host = config.get<string>('MAIL_IMAP_HOST') ?? '';
    this.port = config.get<number>('MAIL_IMAP_PORT') ?? 993;
    this.user = config.get<string>('MAIL_IMAP_USER') ?? '';
    this.password = config.get<string>('MAIL_IMAP_PASSWORD') ?? '';
    this.mailbox = config.get<string>('MAIL_IMAP_MAILBOX') ?? 'INBOX';
  }

  isAvailable(): boolean {
    return Boolean(this.host && this.user && this.password);
  }

  async verifyConnection(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error(
        'Faltan MAIL_IMAP_HOST, MAIL_IMAP_USER o MAIL_IMAP_PASSWORD para usar el buzón IMAP',
      );
    }

    const client = this.buildClient();
    try {
      await client.connect();
      const lock = await client.getMailboxLock(this.mailbox);
      lock.release();
      this.logger.log(`Conexión IMAP verificada contra ${this.host} (${this.user})`);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  /**
   * Trae los correos NO leídos, sin marcarlos.
   *
   * Marcar como leído se hace en `acknowledge`, después de que el ticket existe: si el
   * proceso muere entre leer y crear, el correo sigue pendiente y se reprocesa. La
   * idempotencia por `Message-ID` se encarga de que el reintento no duplique el ticket.
   */
  async fetchPending(limit: number): Promise<IncomingEmail[]> {
    const client = this.buildClient();
    const emails: IncomingEmail[] = [];

    try {
      await client.connect();
      const lock = await client.getMailboxLock(this.mailbox);

      try {
        const unseen = await client.search({ seen: false });
        if (!unseen || unseen.length === 0) return [];

        // Los más viejos primero: el orden de llegada es el orden de atención.
        for (const uid of unseen.slice(0, limit)) {
          const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!message || typeof message === 'boolean' || !message.source) continue;

          try {
            emails.push(await this.parse(message.source, uid));
          } catch (error) {
            // Un correo malformado no debe bloquear la cola: se registra, se marca
            // como leído y se sigue. Si no, el poller se traba en el mismo correo
            // para siempre.
            this.logger.error(
              `Correo uid=${uid} ilegible, se marca como leído: ${(error as Error).message}`,
            );
            await client.messageFlagsAdd(String(uid), [String.raw`\Seen`], { uid: true });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }

    return emails;
  }

  async acknowledge(messageId: string): Promise<void> {
    const client = this.buildClient();

    try {
      await client.connect();
      const lock = await client.getMailboxLock(this.mailbox);

      try {
        const found = await client.search({ header: { 'message-id': messageId } });
        if (!found || found.length === 0) {
          this.logger.warn(`No se encontró el correo ${messageId} para marcarlo como leído`);
          return;
        }
        await client.messageFlagsAdd(found, [String.raw`\Seen`], { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private buildClient(): ImapFlow {
    return new ImapFlow({
      host: this.host,
      port: this.port,
      secure: this.port === 993,
      auth: { user: this.user, pass: this.password },
      // imapflow es muy verboso en info: solo interesan los errores.
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: (obj) => this.logger.warn(obj?.msg ?? 'aviso de IMAP'),
        error: (obj) => this.logger.error(obj?.msg ?? 'error de IMAP'),
      },
    });
  }

  private async parse(raw: Buffer, uid: number): Promise<IncomingEmail> {
    const parsed = await simpleParser(raw);

    const headers: Record<string, string> = {};
    parsed.headerLines.forEach(({ key, line }) => {
      headers[key.toLowerCase()] = line.slice(line.indexOf(':') + 1).trim();
    });

    const from = parsed.from?.value[0];

    return {
      // Un correo sin Message-ID es raro pero posible: se sintetiza uno estable a
      // partir del uid para no perder la idempotencia.
      messageId: parsed.messageId ?? `<imap-uid-${uid}@${this.host}>`,
      from: { address: from?.address ?? 'desconocido@desconocido', name: from?.name },
      to: (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
        .flatMap((a) => a?.value ?? [])
        .map((a) => a.address ?? '')
        .filter(Boolean),
      subject: parsed.subject ?? '',
      text: parsed.text ?? '',
      html: typeof parsed.html === 'string' ? parsed.html : undefined,
      receivedAt: parsed.date ?? new Date(),
      inReplyTo: parsed.inReplyTo,
      references: normalizeReferences(parsed.references),
      headers,
      attachmentCount: parsed.attachments?.length ?? 0,
    };
  }
}

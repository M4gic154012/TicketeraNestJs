import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { simpleParser } from 'mailparser';
import { readdir, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IncomingEmail } from '../../classification';
import { MailboxAdapter, normalizeReferences } from './mailbox.types';

/**
 * Buzón simulado: lee archivos `.eml` de un directorio.
 *
 * Existe por una razón práctica: el buzón institucional está solicitado pero todavía
 * no creado, y esperar el trámite para empezar a probar la ingesta sería tiempo
 * perdido. Con este adaptador se ejercita el camino completo —parseo, clasificación,
 * limpieza, alta de usuario, creación del ticket, threading— usando correos reales
 * guardados como archivo.
 *
 * También sirve después del trámite: es la forma de reproducir un caso raro que
 * apareció en producción sin tener que reenviarse correos a uno mismo.
 *
 * Los archivos procesados se mueven a `procesados/` para no reprocesarlos en cada
 * corrida del poller.
 */
@Injectable()
export class SimulatedMailboxAdapter implements MailboxAdapter {
  readonly name = 'simulado';
  private readonly logger = new Logger(SimulatedMailboxAdapter.name);
  private readonly inboxDir: string;

  /**
   * Qué archivo corresponde a cada Message-ID de la última lectura.
   *
   * La primera versión buscaba el archivo comparando el contenido, y eso movía el
   * archivo equivocado cuando dos correos compartían una subcadena. Recordar la
   * correspondencia es exacto y no cuesta nada.
   */
  private readonly fileByMessageId = new Map<string, string>();

  constructor(config: ConfigService) {
    this.inboxDir = config.get<string>('MAIL_SIMULATED_DIR') ?? './correos-prueba';
  }

  isAvailable(): boolean {
    return existsSync(this.inboxDir);
  }

  async verifyConnection(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error(
        `El directorio de correos simulados no existe: ${this.inboxDir}. ` +
          'Creá el directorio y poné archivos .eml dentro.',
      );
    }
  }

  async fetchPending(limit: number): Promise<IncomingEmail[]> {
    const files = (await readdir(this.inboxDir))
      .filter((f) => f.endsWith('.eml'))
      .slice(0, limit);

    const emails: IncomingEmail[] = [];

    for (const file of files) {
      try {
        const raw = await readFile(join(this.inboxDir, file));
        const email = await this.parse(raw, file);
        this.fileByMessageId.set(email.messageId, file);
        emails.push(email);
      } catch (error) {
        // Un .eml malformado no debe detener la corrida: se registra y se sigue.
        this.logger.error(`No se pudo parsear ${file}: ${(error as Error).message}`);
      }
    }

    return emails;
  }

  async acknowledge(messageId: string): Promise<void> {
    const processedDir = join(this.inboxDir, 'procesados');
    if (!existsSync(processedDir)) return;

    const file = this.fileByMessageId.get(messageId);
    if (!file) {
      this.logger.warn(`No se conoce el archivo del correo ${messageId}; no se mueve`);
      return;
    }

    try {
      await rename(join(this.inboxDir, file), join(processedDir, file));
      this.fileByMessageId.delete(messageId);
    } catch (error) {
      this.logger.warn(`No se pudo mover ${file}: ${(error as Error).message}`);
    }
  }

  /** Mismo parseo que el adaptador IMAP: lo que cambia es de dónde salen los bytes. */
  private async parse(raw: Buffer, fallbackId: string): Promise<IncomingEmail> {
    const parsed = await simpleParser(raw);

    const headers: Record<string, string> = {};
    parsed.headerLines.forEach(({ key, line }) => {
      headers[key.toLowerCase()] = line.slice(line.indexOf(':') + 1).trim();
    });

    const from = parsed.from?.value[0];

    return {
      messageId: parsed.messageId ?? `<simulado-${fallbackId}>`,
      from: { address: from?.address ?? 'desconocido@local', name: from?.name },
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

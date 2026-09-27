import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailProcessingOutcome } from '@ticketera/database';
import { IngestEmailUseCase } from '../../application/use-cases';
import { MAILBOX_ADAPTER, MailboxAdapter } from '../../domain/strategies/mailbox';

export interface PollSummary {
  fetched: number;
  ticketsCreated: number;
  commentsAdded: number;
  discarded: number;
  failed: number;
}

/**
 * Revisa el buzón periódicamente.
 *
 * El correo se marca como leído recién cuando la ingesta terminó bien. Si el proceso
 * muere entre leer y crear el ticket, el correo sigue pendiente y se reprocesa en la
 * corrida siguiente — y la idempotencia por `Message-ID` evita el duplicado. Es más
 * seguro reprocesar que perder un pedido.
 */
@Injectable()
export class MailboxPollerScheduler implements OnModuleInit {
  private readonly logger = new Logger(MailboxPollerScheduler.name);
  private running = false;
  private readonly batchSize: number;

  constructor(
    @Inject(MAILBOX_ADAPTER) private readonly mailbox: MailboxAdapter,
    private readonly ingest: IngestEmailUseCase,
    private readonly config: ConfigService,
  ) {
    this.batchSize = config.get<number>('MAIL_POLL_BATCH_SIZE') ?? 25;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled()) {
      this.logger.warn('Ingesta de correo deshabilitada (MAIL_INGESTION_ENABLED=false)');
      return;
    }

    // Verificar al arrancar: una credencial mal puesta debe fallar acá con un mensaje
    // claro, no en silencio cada cinco minutos en el log del cron.
    try {
      await this.mailbox.verifyConnection();
      this.logger.log(`Buzón '${this.mailbox.name}' verificado y listo`);
    } catch (error) {
      this.logger.error(
        `No se pudo verificar el buzón '${this.mailbox.name}': ${(error as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'mailbox-poll' })
  async scheduledPoll(): Promise<void> {
    if (!this.enabled()) return;
    await this.poll();
  }

  /**
   * Una corrida del poller. Es pública para poder dispararla a demanda por RPC, que
   * es lo que hace útil probar sin esperar el minuto del cron.
   */
  async poll(): Promise<PollSummary> {
    const summary: PollSummary = {
      fetched: 0,
      ticketsCreated: 0,
      commentsAdded: 0,
      discarded: 0,
      failed: 0,
    };

    if (this.running) {
      this.logger.warn('La corrida anterior sigue en curso; se omite esta');
      return summary;
    }
    if (!this.mailbox.isAvailable()) {
      this.logger.debug(`El buzón '${this.mailbox.name}' no está disponible`);
      return summary;
    }

    this.running = true;

    try {
      const emails = await this.mailbox.fetchPending(this.batchSize);
      summary.fetched = emails.length;

      for (const email of emails) {
        const result = await this.ingest.execute(email);

        switch (result.outcome) {
          case EmailProcessingOutcome.TICKET_CREATED:
            summary.ticketsCreated++;
            break;
          case EmailProcessingOutcome.COMMENT_ADDED:
            summary.commentsAdded++;
            break;
          case EmailProcessingOutcome.DISCARDED:
            summary.discarded++;
            break;
          default:
            summary.failed++;
        }

        // Un fallo deja el correo sin marcar, para reintentarlo en la próxima corrida.
        // Los descartes SÍ se marcan: la salida de un crontab no mejora reintentándola.
        if (result.outcome !== EmailProcessingOutcome.FAILED) {
          await this.mailbox.acknowledge(email.messageId).catch((error) => {
            this.logger.warn(
              `No se pudo marcar ${email.messageId} como leído: ${(error as Error).message}`,
            );
          });
        }
      }

      if (summary.fetched > 0) {
        this.logger.log(
          `Buzón: ${summary.fetched} correos | ${summary.ticketsCreated} tickets, ` +
            `${summary.commentsAdded} comentarios, ${summary.discarded} descartados, ` +
            `${summary.failed} con error`,
        );
      }
    } catch (error) {
      // Con el stack: un error sin traza obliga a adivinar dónde ocurrió, y en una
      // cadena parseo -> clasificación -> RPC -> persistencia hay demasiados candidatos.
      this.logger.error(
        `La corrida del buzón falló: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }

    return summary;
  }

  private enabled(): boolean {
    return this.config.get<boolean>('MAIL_INGESTION_ENABLED') !== false;
  }
}

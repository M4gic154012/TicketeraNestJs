import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import {
  TICKETS_PATTERNS,
  TICKETS_SERVICE,
  TicketCategory,
  TicketSourceChannel,
  USERS_PATTERNS,
  USERS_SERVICE,
  UserRole,
  withRpcAuth,
} from '@ticketera/common';
import { EmailProcessingOutcome } from '@ticketera/database';
import { ApplicationService, CircuitBreakerRegistry } from '@ticketera/patterns';
import { firstValueFrom, timeout } from 'rxjs';
import {
  EmailBodyCleaner,
  EmailClassifier,
  EmailDisposition,
  IncomingEmail,
} from '../../domain/classification';
import { ProcessedEmailRepository } from '../../infrastructure/repositories';

export interface IngestResult {
  messageId: string;
  outcome: EmailProcessingOutcome;
  reason: string;
  ticketCode?: string;
}

/**
 * Caso de uso: convertir un correo entrante en un ticket o en un comentario.
 *
 * El orden de los pasos importa y es deliberado:
 *
 *  1. **Idempotencia primero.** Si el correo ya se procesó, se corta acá. Es lo que
 *     hace seguro reprocesar cuando el poller murió a mitad de camino.
 *  2. **Clasificar antes de tocar nada.** Descartar la salida de un crontab no debe
 *     costar ni una consulta a users-service.
 *  3. **Registrar el resultado siempre**, incluidos los descartes y los fallos. Es lo
 *     que permite responder "¿por qué el correo de Fulano no generó ticket?".
 */
@Injectable()
export class IngestEmailUseCase extends ApplicationService<IncomingEmail, IngestResult> {
  private readonly rpcSecret: string;
  private readonly allowedDomains: string[];

  constructor(
    private readonly processed: ProcessedEmailRepository,
    private readonly classifier: EmailClassifier,
    private readonly cleaner: EmailBodyCleaner,
    private readonly breakers: CircuitBreakerRegistry,
    @Inject(USERS_SERVICE) private readonly users: ClientProxy,
    @Inject(TICKETS_SERVICE) private readonly tickets: ClientProxy,
    config: ConfigService,
  ) {
    super();
    this.rpcSecret = config.getOrThrow<string>('RPC_SHARED_SECRET');
    this.allowedDomains = (config.get<string>('MAIL_ALLOWED_DOMAINS') ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }

  async execute(email: IncomingEmail): Promise<IngestResult> {
    if (await this.processed.exists(email.messageId)) {
      return {
        messageId: email.messageId,
        outcome: EmailProcessingOutcome.DISCARDED,
        reason: 'Ya procesado anteriormente (idempotencia)',
      };
    }

    const classification = this.classifier.classify(email);

    if (classification.disposition === EmailDisposition.DISCARD) {
      await this.processed.record({
        email,
        outcome: EmailProcessingOutcome.DISCARDED,
        reason: classification.reason,
      });
      return {
        messageId: email.messageId,
        outcome: EmailProcessingOutcome.DISCARDED,
        reason: classification.reason,
      };
    }

    try {
      if (classification.disposition === EmailDisposition.APPEND_COMMENT) {
        return await this.appendComment(email, classification.ticketCode!);
      }
      return await this.createTicket(email);
    } catch (error) {
      const reason = ((error as Error).message ?? String(error)).slice(0, 300);
      this.logger.error(
        `Fallo procesando ${email.messageId}: ${reason}`,
        (error as Error).stack,
      );

      // Se registra como FAILED, no como procesado con éxito: así queda visible en la
      // bitácora y se puede reintentar a mano sin perder el rastro.
      await this.processed.record({
        email,
        outcome: EmailProcessingOutcome.FAILED,
        reason,
      });

      return { messageId: email.messageId, outcome: EmailProcessingOutcome.FAILED, reason };
    }
  }

  private async createTicket(email: IncomingEmail): Promise<IngestResult> {
    const requester = await this.resolveRequester(email);

    const title = email.subject.trim() || `Solicitud de ${email.from.address}`;
    const description = this.cleaner.buildDescription(
      email.subject,
      email.text,
      email.from.address,
    );

    const ticket = await this.callTickets<{ id: string; code: string }>(
      TICKETS_PATTERNS.create,
      {
        // El título se recorta al límite del DTO: un asunto larguísimo no debe
        // hacer fallar la creación del ticket.
        title: title.slice(0, 200),
        description: description.slice(0, 10_000),
        requesterId: requester.id,
        category: TicketCategory.OTHER,
        autoAssign: true,
        sourceChannel: TicketSourceChannel.EMAIL,
        sourceMessageId: email.messageId,
      },
    );

    await this.processed.record({
      email,
      outcome: EmailProcessingOutcome.TICKET_CREATED,
      reason: requester.created
        ? `Ticket creado; usuario ${email.from.address} dado de alta automáticamente`
        : 'Ticket creado',
      ticketId: ticket.id,
      ticketCode: ticket.code,
    });

    this.logger.log(`Correo de ${email.from.address} -> ticket ${ticket.code}`);

    return {
      messageId: email.messageId,
      outcome: EmailProcessingOutcome.TICKET_CREATED,
      reason: 'Ticket creado',
      ticketCode: ticket.code,
    };
  }

  private async appendComment(email: IncomingEmail, ticketCode: string): Promise<IngestResult> {
    const author = await this.resolveRequester(email);

    const ticket = await this.callTickets<{ id: string; code: string } | null>(
      TICKETS_PATTERNS.findByCode,
      { code: ticketCode },
    );

    // El ticket puede no existir: alguien inventó el código, o el correo es de un
    // sistema anterior. Se crea un ticket nuevo en lugar de perder el mensaje.
    if (!ticket) {
      this.logger.warn(`El ticket ${ticketCode} no existe; se crea uno nuevo`);
      return this.createTicket(email);
    }

    await this.callTickets(TICKETS_PATTERNS.addComment, {
      ticketId: ticket.id,
      authorId: author.id,
      authorRole: author.role,
      body: this.cleaner.clean(email.text) || '(respuesta sin texto legible)',
      // Una respuesta por correo nunca es una nota interna: el solicitante la ve.
      isInternal: false,
      sourceMessageId: email.messageId,
    });

    await this.processed.record({
      email,
      outcome: EmailProcessingOutcome.COMMENT_ADDED,
      reason: `Comentario agregado al ticket ${ticketCode}`,
      ticketId: ticket.id,
      ticketCode,
    });

    return {
      messageId: email.messageId,
      outcome: EmailProcessingOutcome.COMMENT_ADDED,
      reason: `Comentario agregado a ${ticketCode}`,
      ticketCode,
    };
  }

  /** Resuelve el remitente, dándolo de alta si es su primer correo. */
  private async resolveRequester(
    email: IncomingEmail,
  ): Promise<{ id: string; role: UserRole; created: boolean }> {
    const breaker = this.breakers.get('users-service');

    return breaker.execute(() =>
      firstValueFrom(
        this.users
          .send<{ id: string; role: UserRole; created: boolean }>(
            USERS_PATTERNS.findOrCreateByEmail,
            withRpcAuth(
              {
                email: email.from.address,
                fullName: email.from.name,
                allowedDomains: this.allowedDomains,
              },
              this.rpcSecret,
            ),
          )
          .pipe(timeout(5_000)),
      ),
    );
  }

  private callTickets<T>(pattern: string, payload: unknown): Promise<T> {
    const breaker = this.breakers.get('tickets-service');

    return breaker.execute(() =>
      firstValueFrom(
        this.tickets.send<T>(pattern, withRpcAuth(payload, this.rpcSecret)).pipe(timeout(8_000)),
      ),
    );
  }
}

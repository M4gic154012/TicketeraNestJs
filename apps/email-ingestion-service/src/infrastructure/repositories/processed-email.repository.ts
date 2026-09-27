import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EmailProcessingOutcome, ProcessedEmail } from '@ticketera/database';
import { Repository } from 'typeorm';
import { IncomingEmail } from '../../domain/classification';

export interface RecordInput {
  email: IncomingEmail;
  outcome: EmailProcessingOutcome;
  reason: string;
  ticketId?: string;
  ticketCode?: string;
}

/**
 * Bitácora de correos procesados.
 *
 * No usa `TypeOrmBaseRepository` porque no necesita Specifications: son dos consultas
 * puntuales y un insert idempotente. Heredar por herencia sola sería ceremonia sin
 * beneficio.
 */
@Injectable()
export class ProcessedEmailRepository {
  private readonly logger = new Logger(ProcessedEmailRepository.name);

  constructor(
    @InjectRepository(ProcessedEmail) private readonly orm: Repository<ProcessedEmail>,
  ) {}

  /**
   * ¿Ya se procesó este correo con un resultado definitivo?
   *
   * Los FAILED **no** cuentan, y es deliberado: el poller deja sin marcar como leído
   * el correo que falló justamente para reintentarlo. Si `exists` los contara, el
   * reintento se descartaría por "ya procesado" y el correo quedaría perdido — el
   * ticket nunca se crearía y nadie se enteraría. Pasó al probar: el primer intento
   * falló porque faltaba un handler, y el segundo lo descartó en lugar de reintentar.
   *
   * Se compara por `md5(messageId)` para poder usar el índice único, que es funcional
   * sobre el hash: un Message-ID puede llegar a 998 caracteres y no cabe en una
   * entrada de índice btree.
   */
  async exists(messageId: string): Promise<boolean> {
    const found = await this.orm
      .createQueryBuilder('pe')
      .select('pe.id')
      .where('md5(pe."messageId") = md5(:messageId)', { messageId })
      .andWhere('pe.outcome != :failed', { failed: EmailProcessingOutcome.FAILED })
      .limit(1)
      .getRawOne();

    return found !== undefined;
  }

  /**
   * Registra el resultado del procesamiento.
   *
   * `orIgnore` sobre el índice único: si dos corridas del poller procesan el mismo
   * correo a la vez, la segunda no falla — el ticket duplicado ya lo evita el chequeo
   * de `exists`, y esto cubre la carrera entre ese chequeo y el insert.
   */
  async record(input: RecordInput): Promise<void> {
    const { email } = input;

    try {
      // Un correo que había fallado y ahora se procesó bien debe ACTUALIZAR su
      // registro, no chocar contra el índice único y perder el resultado nuevo.
      const previous = await this.orm
        .createQueryBuilder('pe')
        .where('md5(pe."messageId") = md5(:messageId)', { messageId: email.messageId })
        .getOne();

      if (previous) {
        await this.orm.update(previous.id, {
          outcome: input.outcome,
          reason: input.reason.slice(0, 300),
          ticketId: input.ticketId ?? null,
          ticketCode: input.ticketCode ?? null,
        });
        return;
      }

      await this.orm
        .createQueryBuilder()
        .insert()
        .into(ProcessedEmail)
        .values({
          messageId: email.messageId.slice(0, 998),
          fromAddress: email.from.address.slice(0, 255),
          subject: (email.subject || '(sin asunto)').slice(0, 500),
          outcome: input.outcome,
          reason: input.reason.slice(0, 300),
          ticketId: input.ticketId ?? null,
          ticketCode: input.ticketCode ?? null,
          receivedAt: email.receivedAt,
        })
        .orIgnore()
        .execute();
    } catch (error) {
      // La bitácora no debe tumbar la ingesta: el ticket ya existe y eso es lo que
      // importa. Se registra el problema y se sigue.
      this.logger.error(
        `No se pudo registrar el correo ${email.messageId}: ${(error as Error).message}`,
      );
    }
  }

  /** Últimos correos procesados, para diagnosticar qué entró y qué se descartó. */
  async recent(limit: number, outcome?: EmailProcessingOutcome): Promise<ProcessedEmail[]> {
    return this.orm.find({
      where: outcome ? { outcome } : {},
      order: { receivedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }
}

import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { EMAIL_PATTERNS } from '@ticketera/common';
import { EmailProcessingOutcome, ProcessedEmail } from '@ticketera/database';
import { ProcessedEmailRepository } from './infrastructure/repositories';
import { MailboxPollerScheduler, PollSummary } from './infrastructure/scheduling';

@Controller()
export class EmailIngestionController {
  constructor(
    private readonly poller: MailboxPollerScheduler,
    private readonly processed: ProcessedEmailRepository,
  ) {}

  /**
   * Dispara una corrida a demanda. Es lo que permite probar la ingesta sin esperar el
   * minuto del cron: se deja un `.eml` en el directorio y se llama a esto.
   */
  @MessagePattern(EMAIL_PATTERNS.pollNow)
  pollNow(): Promise<PollSummary> {
    return this.poller.poll();
  }

  /**
   * Bitácora de lo procesado. Con un buzón que recibe salida de crontab, "¿por qué el
   * correo de Fulano no generó ticket?" es una pregunta frecuente, y esto la contesta
   * sin revisar logs.
   */
  @MessagePattern(EMAIL_PATTERNS.processedLog)
  recent(
    @Payload() query: { limit?: number; outcome?: EmailProcessingOutcome },
  ): Promise<ProcessedEmail[]> {
    return this.processed.recent(query.limit ?? 50, query.outcome);
  }
}

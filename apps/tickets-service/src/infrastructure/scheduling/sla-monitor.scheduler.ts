import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SweepSlaBreachesUseCase } from '../../application/use-cases';

/**
 * Vigila los SLA vencidos.
 *
 * `preventOverlap` evita que un barrido lento se solape con el siguiente y
 * duplique trabajo. Con varias réplicas del servicio harían falta locks
 * distribuidos; con una sola instancia del scheduler, esto alcanza.
 */
@Injectable()
export class SlaMonitorScheduler implements OnModuleInit {
  private readonly logger = new Logger(SlaMonitorScheduler.name);
  private running = false;

  constructor(
    private readonly sweep: SweepSlaBreachesUseCase,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled()) {
      this.logger.log('Barrido de SLA deshabilitado en esta instancia (SCHEDULER_ENABLED=false)');
    }
  }

  /**
   * Con más de una réplica, solo una debe barrer: el guard `running` es memoria
   * local, no un lock distribuido, así que dos réplicas harían dos barridos en
   * paralelo. Hasta tener `pg_advisory_lock`, esto lo evita con una variable.
   */
  private enabled(): boolean {
    // `get<boolean>`, no `get<string>`: el esquema lo declara como Joi.boolean(),
    // así que ConfigService devuelve un booleano y la comparación contra el string
    // 'false' era siempre falsa — el flag no desactivaba nada.
    return this.config.get<boolean>('SCHEDULER_ENABLED') !== false;
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'sla-sweep' })
  async handle(): Promise<void> {
    if (!this.enabled()) return;

    if (this.running) {
      this.logger.warn('Barrido de SLA anterior aún en curso; se omite esta corrida');
      return;
    }

    this.running = true;
    try {
      const result = await this.sweep.execute();
      this.logger.debug(
        `Barrido de SLA: ${result.scanned} revisados, ${result.newlyBreached} incumplidos`,
      );
    } catch (error) {
      this.logger.error(`Barrido de SLA falló: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

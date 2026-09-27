import { Inject, Injectable } from '@nestjs/common';
import { StrategyResolver } from '@ticketera/patterns';
import { SLA_STRATEGIES, SlaContext, SlaResult, SlaStrategy } from './sla.types';

/**
 * Segunda familia Strategy del dominio: decide qué política de SLA rige a un
 * ticket. Separada de la de asignación porque son ejes independientes — cambiar
 * cómo se reparte el trabajo no debe alterar cuándo vence.
 */
@Injectable()
export class SlaStrategyResolver extends StrategyResolver<SlaContext, SlaResult> {
  constructor(@Inject(SLA_STRATEGIES) strategies: SlaStrategy[]) {
    super(strategies);
  }

  protected get fallbackStrategyName(): string {
    return 'business-hours';
  }

  calculate(context: SlaContext): Promise<SlaResult> {
    return this.run(context) as Promise<SlaResult>;
  }
}

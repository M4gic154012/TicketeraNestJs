import { Inject, Injectable } from '@nestjs/common';
import { StrategyResolver } from '@ticketera/patterns';
import {
  CHANNEL_STRATEGIES,
  ChannelStrategy,
  DeliveryContext,
  DeliveryResult,
} from './channel.types';

@Injectable()
export class ChannelStrategyResolver extends StrategyResolver<DeliveryContext, DeliveryResult> {
  constructor(@Inject(CHANNEL_STRATEGIES) strategies: ChannelStrategy[]) {
    super(strategies);
  }

  /** Si el canal pedido no puede entregar, la bandeja in-app siempre funciona. */
  protected get fallbackStrategyName(): string {
    return 'in-app';
  }

  deliver(context: DeliveryContext): Promise<DeliveryResult> {
    return this.run(context) as Promise<DeliveryResult>;
  }
}

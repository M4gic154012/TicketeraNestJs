import { Injectable } from '@nestjs/common';
import { NotificationChannel } from '@ticketera/common';
import { ChannelStrategy, DeliveryContext, DeliveryResult } from './channel.types';

/**
 * Canal in-app: la notificación ya está en la base, "entregarla" es marcarla
 * como enviada para que el frontend la liste. No sale de la red.
 */
@Injectable()
export class InAppChannelStrategy implements ChannelStrategy {
  readonly name = 'in-app';

  supports(context: DeliveryContext): boolean {
    return context.notification.channel === NotificationChannel.IN_APP;
  }

  execute(context: DeliveryContext): DeliveryResult {
    context.notification.markSent();
    return {
      delivered: true,
      channel: NotificationChannel.IN_APP,
      detail: 'Disponible en la bandeja del usuario',
    };
  }
}

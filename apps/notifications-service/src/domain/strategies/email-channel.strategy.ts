import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@ticketera/common';
import { ChannelStrategy, DeliveryContext, DeliveryResult } from './channel.types';

/**
 * Canal email.
 *
 * El envío real está detrás de esta interfaz a propósito: cambiar a SES, SMTP o
 * un proveedor externo es reemplazar el cuerpo de `execute`, sin tocar los casos
 * de uso ni el dominio.
 *
 * Por ahora registra el envío en el log en lugar de salir a un SMTP — conectarlo
 * exige credenciales y plantillas que este backend todavía no define.
 */
@Injectable()
export class EmailChannelStrategy implements ChannelStrategy {
  readonly name = 'email';
  private readonly logger = new Logger(EmailChannelStrategy.name);

  supports(context: DeliveryContext): boolean {
    return (
      context.notification.channel === NotificationChannel.EMAIL && !!context.recipientEmail
    );
  }

  async execute(context: DeliveryContext): Promise<DeliveryResult> {
    const { notification, recipientEmail } = context;

    if (!recipientEmail) {
      notification.markFailed('Destinatario sin email');
      return {
        delivered: false,
        channel: NotificationChannel.EMAIL,
        detail: 'Destinatario sin email registrado',
      };
    }

    this.logger.log(`[PENDIENTE DE PROVEEDOR] email a ${recipientEmail}: ${notification.subject}`);
    notification.markSent();

    return {
      delivered: true,
      channel: NotificationChannel.EMAIL,
      detail: `Encolado para ${recipientEmail}`,
    };
  }
}

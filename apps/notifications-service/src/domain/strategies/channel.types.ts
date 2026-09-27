import { NotificationChannel } from '@ticketera/common';
import { Notification } from '@ticketera/database';
import { Strategy } from '@ticketera/patterns';

export interface DeliveryContext {
  notification: Notification;
  recipientEmail: string | null;
}

export interface DeliveryResult {
  delivered: boolean;
  channel: NotificationChannel;
  detail: string;
}

export type ChannelStrategy = Strategy<DeliveryContext, DeliveryResult>;

export const CHANNEL_STRATEGIES = 'CHANNEL_STRATEGIES';

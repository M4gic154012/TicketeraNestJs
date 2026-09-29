import { bootstrapRpcMicroservice } from '@ticketera/common';
import { NotificationsModule } from './notifications.module';

void bootstrapRpcMicroservice({
  module: NotificationsModule,
  serviceName: 'notifications-service',
  portEnvVar: 'NOTIFICATIONS_TCP_PORT',
});

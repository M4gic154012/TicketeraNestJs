import { bootstrapRpcMicroservice } from '@ticketera/common';
import { TicketsModule } from './tickets.module';

void bootstrapRpcMicroservice({
  module: TicketsModule,
  serviceName: 'tickets-service',
  portEnvVar: 'TICKETS_TCP_PORT',
});

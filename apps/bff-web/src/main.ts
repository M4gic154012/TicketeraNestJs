import { bootstrapRpcMicroservice } from '@ticketera/common';
import { BffModule } from './bff.module';

void bootstrapRpcMicroservice({
  module: BffModule,
  serviceName: 'bff-web',
  portEnvVar: 'BFF_WEB_TCP_PORT',
});

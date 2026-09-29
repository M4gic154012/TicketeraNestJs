import { bootstrapRpcMicroservice } from '@ticketera/common';
import { UsersModule } from './users.module';

void bootstrapRpcMicroservice({
  module: UsersModule,
  serviceName: 'users-service',
  portEnvVar: 'USERS_TCP_PORT',
});

import { bootstrapRpcMicroservice } from '@ticketera/common';
import { EmailIngestionModule } from './email-ingestion.module';

void bootstrapRpcMicroservice({
  module: EmailIngestionModule,
  serviceName: 'email-ingestion-service',
  portEnvVar: 'EMAIL_INGESTION_TCP_PORT',
});

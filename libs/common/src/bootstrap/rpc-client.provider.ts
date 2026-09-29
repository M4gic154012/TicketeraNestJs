import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsProviderAsyncOptions, Transport } from '@nestjs/microservices';

/**
 * Entrada de `ClientsModule.registerAsync([...])` para un cliente TCP saliente.
 *
 * Los cinco módulos que hablan hacia otro proceso (gateway, BFF, tickets,
 * notifications, email-ingestion) repetían este mismo bloque -- name, imports,
 * inject, useFactory con transporte TCP y host/puerto por variable de entorno
 * -- una vez por servicio destino. SonarQube lo marcó como duplicación real
 * tras extraer `bootstrapRpcMicroservice`: mismo patrón, mismo motivo.
 *
 * `users-service` nunca aparece del lado que llama a esto: no le consulta a
 * nadie más (ver CLAUDE.md), así que no tiene ningún `ClientsModule.registerAsync`.
 */
export function registerRpcClient(
  name: string,
  hostEnvVar: string,
  portEnvVar: string,
): ClientsProviderAsyncOptions {
  return {
    name,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({
      transport: Transport.TCP,
      options: {
        host: config.getOrThrow<string>(hostEnvVar),
        port: config.getOrThrow<number>(portEnvVar),
      },
    }),
  };
}

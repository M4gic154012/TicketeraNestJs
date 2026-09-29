import { Type, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { AllRpcExceptionsFilter } from '../filters/rpc-exception.filter';
import { RpcAuthGuard } from '../guards/rpc-auth.guard';
import { RpcCorrelationInterceptor } from '../interceptors/rpc-correlation.interceptor';

export interface RpcMicroserviceOptions {
  /** Módulo raíz del microservicio (TicketsModule, UsersModule, etc.). */
  module: Type<unknown>;
  /** Nombre para los logs y el mensaje de arranque ('tickets-service'). */
  serviceName: string;
  /** Variable de entorno con el puerto TCP ('TICKETS_TCP_PORT'). */
  portEnvVar: string;
}

/**
 * Arranque común a los cinco microservicios TCP.
 *
 * Extraído acá porque los cinco `main.ts` eran idénticos salvo tres datos
 * (módulo, nombre del servicio, variable de puerto) — Sonar lo marcó como
 * duplicación real tras sumar `RpcCorrelationInterceptor` a los cinco por
 * separado. La guardia de autenticación y el interceptor de correlación viven
 * en un solo lugar: agregar un microservicio nuevo ya no puede olvidarse de
 * ninguno de los dos, porque no hay dónde olvidarlos.
 *
 * Host y puerto se leen de `process.env` directo, NO creando un
 * `ApplicationContext` previo: eso instanciaba `TypeOrmModule` y
 * `ScheduleModule` completos solo para leer dos variables, duplicando
 * conexiones a la base y registrando los crons dos veces en cada arranque. El
 * esquema de Joi se valida igual cuando se crea el microservicio.
 */
export async function bootstrapRpcMicroservice(options: RpcMicroserviceOptions): Promise<void> {
  const port = Number(process.env[options.portEnvVar] ?? 0);
  if (!port) throw new Error(`${options.portEnvVar} es obligatoria`);

  // Por omisión loopback: escuchar en 0.0.0.0 deja el puerto interno
  // alcanzable desde toda la red, y el protocolo TCP de Nest no pide
  // credenciales por sí solo.
  const host = process.env.MICROSERVICE_BIND_HOST ?? '127.0.0.1';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(options.module, {
    transport: Transport.TCP,
    options: { host, port },
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.useGlobalFilters(new AllRpcExceptionsFilter());
  // Autenticación entre servicios: ningún handler atiende un mensaje sin el
  // secreto compartido, ni siquiera si alguien alcanza el puerto directamente.
  app.useGlobalGuards(new RpcAuthGuard(app.get(ConfigService)));
  // Debe registrarse antes de que cualquier handler use RequestContext: deja
  // el correlation-id del mensaje entrante disponible para toda la llamada,
  // incluidas las llamadas RPC que ese handler haga a su vez hacia otro
  // servicio (ver rpc-correlation.interceptor.ts).
  app.useGlobalInterceptors(new RpcCorrelationInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.enableShutdownHooks();

  await app.listen();
  // Por el logger, no console.log: texto plano entre líneas JSON rompe el
  // parseo del stream.
  logger.log(`${options.serviceName} escuchando TCP en ${host}:${port}`, 'Bootstrap');
}

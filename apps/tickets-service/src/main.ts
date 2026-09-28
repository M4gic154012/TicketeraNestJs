import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AllRpcExceptionsFilter, RpcAuthGuard, RpcCorrelationInterceptor } from '@ticketera/common';
import { Logger } from 'nestjs-pino';
import { TicketsModule } from './tickets.module';

async function bootstrap(): Promise<void> {
  // Host y puerto se leen de process.env directo, NO creando un
  // ApplicationContext previo: eso instanciaba TypeOrmModule y ScheduleModule
  // completos solo para leer dos variables, duplicando conexiones a la base y
  // registrando los crons dos veces en cada arranque. El esquema de Joi se valida
  // igual cuando se crea el microservicio.
  const port = Number(process.env.TICKETS_TCP_PORT ?? 0);
  if (!port) throw new Error('TICKETS_TCP_PORT es obligatoria');

  // Por omisión loopback: escuchar en 0.0.0.0 deja el puerto interno alcanzable
  // desde toda la red, y el protocolo TCP de Nest no pide credenciales por sí solo.
  const host = process.env.MICROSERVICE_BIND_HOST ?? '127.0.0.1';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(TicketsModule, {
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
  // Por el logger, no console.log: texto plano entre líneas JSON rompe el parseo
  // del stream.
  logger.log(`tickets-service escuchando TCP en ${host}:${port}`, 'Bootstrap');
}

void bootstrap();

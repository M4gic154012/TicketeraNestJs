import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AllRpcExceptionsFilter, RpcAuthGuard } from '@ticketera/common';
import { Logger } from 'nestjs-pino';
import { UsersModule } from './users.module';

async function bootstrap(): Promise<void> {
  // Host y puerto se leen de process.env directo, NO creando un
  // ApplicationContext previo: eso instanciaba TypeOrmModule y ScheduleModule
  // completos solo para leer dos variables, duplicando conexiones a la base y
  // registrando los crons dos veces en cada arranque. El esquema de Joi se valida
  // igual cuando se crea el microservicio.
  const port = Number(process.env.USERS_TCP_PORT ?? 0);
  if (!port) throw new Error('USERS_TCP_PORT es obligatoria');

  // Por omisión loopback: escuchar en 0.0.0.0 deja el puerto interno alcanzable
  // desde toda la red, y el protocolo TCP de Nest no pide credenciales por sí solo.
  const host = process.env.MICROSERVICE_BIND_HOST ?? '127.0.0.1';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(UsersModule, {
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
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.enableShutdownHooks();

  await app.listen();
  // Por el logger, no console.log: texto plano entre líneas JSON rompe el parseo
  // del stream.
  logger.log(`users-service escuchando TCP en ${host}:${port}`, 'Bootstrap');
}

void bootstrap();

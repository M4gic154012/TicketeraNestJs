import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  AppConfigModule,
  BFF_WEB_SERVICE,
  CorrelationIdMiddleware,
  NOTIFICATIONS_SERVICE,
  TICKETS_SERVICE,
  USERS_SERVICE,
  buildLoggerConfig,
} from '@ticketera/common';
import { CircuitBreakerModule } from '@ticketera/patterns';
import { LoggerModule } from 'nestjs-pino';
import { AuthService, JwtAuthGuard, JwtStrategy, RolesGuard } from './auth';
import {
  AuthController,
  HealthController,
  NotificationsController,
  TicketsController,
  UpstreamClient,
  UsersController,
} from './routes';

/**
 * API Gateway: único proceso expuesto al exterior.
 *
 * Concentra las responsabilidades de borde — TLS terminado por el proxy, CORS,
 * rate limiting, autenticación, validación de entrada, correlación de logs y
 * circuit breaking hacia adentro — para que ningún microservicio tenga que
 * reimplementarlas.
 *
 * No importa DatabaseModule: el gateway no habla con Postgres.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot(buildLoggerConfig('api-gateway')),
    CircuitBreakerModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // issuer/audience acotan dónde vale el token: sin ellos, un token
        // firmado con el mismo secreto por otro sistema sería aceptado acá.
        signOptions: {
          algorithm: 'HS256',
          issuer: config.get<string>('JWT_ISSUER') ?? 'ticketera',
          audience: config.get<string>('JWT_AUDIENCE') ?? 'ticketera-api',
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_MS') ?? 60_000,
            limit: config.get<number>('THROTTLE_LIMIT') ?? 100,
          },
        ],
      }),
    }),
    ClientsModule.registerAsync([
      {
        name: BFF_WEB_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.getOrThrow<string>('BFF_WEB_HOST'),
            port: config.getOrThrow<number>('BFF_WEB_TCP_PORT'),
          },
        }),
      },
      {
        name: TICKETS_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.getOrThrow<string>('TICKETS_HOST'),
            port: config.getOrThrow<number>('TICKETS_TCP_PORT'),
          },
        }),
      },
      {
        name: USERS_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.getOrThrow<string>('USERS_HOST'),
            port: config.getOrThrow<number>('USERS_TCP_PORT'),
          },
        }),
      },
      {
        name: NOTIFICATIONS_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.getOrThrow<string>('NOTIFICATIONS_HOST'),
            port: config.getOrThrow<number>('NOTIFICATIONS_TCP_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [
    AuthController,
    TicketsController,
    UsersController,
    NotificationsController,
    HealthController,
  ],
  providers: [
    UpstreamClient,
    AuthService,
    JwtStrategy,
    // Orden de los guards globales: primero el rate limit (rechaza barato),
    // después autenticación, y al final autorización por rol.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class GatewayModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}

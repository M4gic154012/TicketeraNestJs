import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalHttpExceptionFilter, TimeoutInterceptor } from '@ticketera/common';
import { swaggerBasicAuth } from './swagger-basic-auth.middleware';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { GatewayModule } from './gateway.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(GatewayModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.setGlobalPrefix('api/v1');

  app.use(helmet());
  app.enableCors({
    // Lista explícita: un CORS con origin `true` refleja cualquier origen y
    // habilita a cualquier sitio a llamar a la API con las credenciales del usuario.
    origin: config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Rechaza explícitamente campos no declarados en el DTO en lugar de
      // descartarlos en silencio: el cliente se entera de que envió algo inválido.
      forbidNonWhitelisted: true,
      transform: true,
      // SIN enableImplicitConversion: convertía los booleanos de query string con la
      // semántica de `Boolean(string)`, donde `'false'` da `true`, y pisaba los
      // `@Transform` de los DTOs. El resultado era que `unassignedOnly=false`
      // filtraba igual que `=true`.
      //
      // Cada DTO declara su conversión explícitamente (`@Type(() => Number)` para los
      // numéricos, `@Transform` para los booleanos), que además es más predecible:
      // se lee en el campo, no en una opción global.
      // No se usa `disableErrorMessages` en producción: suprimía TODO el detalle y
      // cualquier entrada malformada respondía "Bad Request" sin decir qué campo
      // corregir. En cambio se devuelve la lista de campos inválidos con su motivo
      // —que es información que el cliente mismo envió— y nada del interior.
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Hay campos inválidos en la petición',
          fields: errors.map((error) => ({
            field: error.property,
            constraints: Object.values(error.constraints ?? {}),
          })),
        }),
    }),
  );
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalInterceptors(new TimeoutInterceptor(15_000));

  // Swagger se publica solo si se habilita explícitamente. En producción va detrás de
  // autenticación básica: la documentación completa es un mapa de la superficie de la
  // API, y dejarla abierta en un ambiente accesible es regalarlo. El esquema de
  // configuración exige las credenciales en ese caso, así que no puede quedar pública
  // por un olvido.
  if (config.get<boolean>('ENABLE_SWAGGER') === true) {
    const swaggerPath = 'api/docs';

    if (isProduction) {
      const user = config.getOrThrow<string>('SWAGGER_USER');
      const password = config.getOrThrow<string>('SWAGGER_PASSWORD');
      // @nestjs/swagger publica el documento en rutas HERMANAS de `swaggerPath`
      // (`${swaggerPath}-json`, `${swaggerPath}-yaml`), no hijas: `app.use('/api/docs', ...)`
      // cubre `/api/docs` y `/api/docs/*`, pero no `/api/docs-json`. Sin las tres
      // rutas explícitas, el contrato completo de la API quedaba servido sin
      // autenticación pese a la protección de arriba.
      app.use(
        [`/${swaggerPath}`, `/${swaggerPath}-json`, `/${swaggerPath}-yaml`],
        swaggerBasicAuth(user, password),
      );
      logger.log(`Documentación en /${swaggerPath}, protegida con credenciales`, 'Bootstrap');
    } else {
      logger.log(`Documentación abierta en /${swaggerPath} (entorno no productivo)`, 'Bootstrap');
    }

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ticketera API')
      .setDescription(
        'API de mesa de ayuda del CMM. Gateway HTTP sobre BFF y microservicios.\n\n' +
          'Todas las rutas requieren `Authorization: Bearer <token>` salvo `/auth/login`, ' +
          '`/auth/refresh`, `/health/live` y `/health/ready`.\n\n' +
          'La identidad siempre sale del token: campos como `requesterId`, `authorId` o ' +
          '`changedById` no se envían en el cuerpo.',
      )
      .setVersion(process.env.APP_VERSION ?? '1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .addTag('auth', 'Autenticación y renovación de tokens')
      .addTag('tickets', 'Creación, búsqueda y ciclo de vida de los tickets')
      .addTag('users', 'Usuarios y agentes')
      .addTag('notifications', 'Bandeja de notificaciones del usuario')
      .addTag('health', 'Estado del sistema')
      .build();

    SwaggerModule.setup(swaggerPath, app, SwaggerModule.createDocument(app, swaggerConfig), {
      swaggerOptions: {
        // El token sobrevive al refresco de la página: sin esto hay que pegarlo de
        // nuevo en cada recarga, que al probar una API es molesto y constante.
        persistAuthorization: true,
        docExpansion: 'none',
        tagsSorter: 'alpha',
      },
      customSiteTitle: 'Ticketera API',
    });
  }

  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('GATEWAY_HTTP_PORT');
  await app.listen(port, '0.0.0.0');
  logger.log(`api-gateway escuchando HTTP en ${port} (prefijo /api/v1)`, 'Bootstrap');
}

void bootstrap();

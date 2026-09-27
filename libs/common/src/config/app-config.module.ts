import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './validate-env';

/**
 * Configuración compartida por los cinco procesos: un único .env en la raíz del
 * monorepo y un único esquema de validación, para que ningún servicio arranque
 * con una vista parcial del entorno.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      // Validación propia en lugar de `validationSchema`: además de aplicar el
      // esquema, rechaza variables con prefijo del proyecto que no estén
      // declaradas (errores de tipeo). Ver validate-env.ts.
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}

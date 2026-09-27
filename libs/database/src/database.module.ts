import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TypeOrmUnitOfWork } from './repositories/typeorm-unit-of-work';
import { buildTypeOrmOptions } from './typeorm.config';

/**
 * Conexión a Postgres para los servicios que persisten. El gateway y el BFF no
 * importan este módulo: no deben tener acceso directo a la base, solo hablar por
 * el transporte con los microservicios dueños de cada tabla.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
  ],
  providers: [
    {
      provide: TypeOrmUnitOfWork,
      useFactory: (dataSource: DataSource) => new TypeOrmUnitOfWork(dataSource),
      inject: [DataSource],
    },
  ],
  exports: [TypeOrmModule, TypeOrmUnitOfWork],
})
export class DatabaseModule {}

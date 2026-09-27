import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, Public, UserRole } from '@ticketera/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UpstreamClient } from './bff.client';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly upstream: UpstreamClient) {}

  /** Liveness: responde si el proceso está vivo, sin tocar dependencias. */
  @Public()
  @Get('live')
  live() {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      // Con imágenes `:latest` y contenedores de larga vida, esto es lo único que
      // dice qué versión está sirviendo tráfico.
      version: process.env.APP_VERSION ?? 'dev',
    };
  }

  /**
   * Readiness: ¿puede este proceso atender tráfico AHORA?
   *
   * Es lo que consulta un balanceador. `/live` no alcanza: devuelve 200 con todos
   * los circuitos abiertos y la base caída, así que el balanceador seguiría
   * mandando tráfico a un proceso que no puede servirlo.
   *
   * A diferencia de `/health`, no revela topología ni nombres de servicios: es
   * público, así que solo responde ok/degraded y cuántos circuitos están abiertos.
   */
  @Public()
  @Get('ready')
  ready(@Res({ passthrough: true }) response: Response) {
    const open = this.upstream.circuits().filter((c) => c.state === 'OPEN').length;

    if (open > 0) {
      // 503 para que el balanceador saque esta instancia de rotación.
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'degraded', openCircuits: open };
    }

    return { status: 'ok', openCircuits: 0 };
  }

  /**
   * Estado de los circuitos hacia los servicios internos. Es la vista rápida de
   * "qué está degradado" sin tener que leer logs de cinco procesos.
   *
   * Requiere rol de supervisión: expuesto públicamente revelaba la topología
   * interna y, peor, le daba a un atacante señal en tiempo real de si estaba
   * logrando degradar un servicio. El liveness público de arriba alcanza para
   * los health checks del orquestador.
   */
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Estado del gateway y de los circuitos internos' })
  status() {
    const circuits = this.upstream.circuits();
    const degraded = circuits.filter((c) => c.state !== 'CLOSED');

    return {
      status: degraded.length === 0 ? 'ok' : 'degraded',
      uptime: Math.floor(process.uptime()),
      circuits,
    };
  }
}

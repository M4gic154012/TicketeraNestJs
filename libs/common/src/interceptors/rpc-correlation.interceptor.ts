import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { RequestContext } from '../context/request-context';

/** Campo que transporta el correlation-id en cada mensaje RPC. */
export const RPC_CORRELATION_FIELD = '__correlationId';

/**
 * Recibe el correlation-id que `withRpcAuth` adjuntó al payload saliente y lo
 * deja disponible (`RequestContext`) durante todo el handler — incluidas las
 * llamadas RPC que ese handler haga a su vez hacia otro servicio, que lo
 * heredan automáticamente sin que nadie tenga que reenviarlo a mano. Es lo
 * mismo que hace `CorrelationIdMiddleware` en el borde HTTP del gateway, pero
 * para el borde de entrada de cada microservicio.
 *
 * Complementa a `RpcAuthGuard`, no lo reemplaza: el guard corre antes (los
 * guards siempre corren antes que los interceptores) y ya limpió el campo de
 * autenticación del payload; este interceptor limpia el de correlación antes
 * de que llegue a la lógica de negocio.
 *
 * El envoltorio en `Observable` es necesario porque `next.handle()` no
 * ejecuta el handler al llamarlo: lo ejecuta recién cuando alguien se
 * suscribe. Si el `RequestContext.run` no envolviera la suscripción, el
 * handler correría fuera del contexto y `withRpcAuth` no vería ningún
 * correlation-id activo más adelante en esa misma llamada.
 */
@Injectable()
export class RpcCorrelationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RpcCorrelationInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const payload = context.switchToRpc().getData() as Record<string, unknown> | undefined;
    const provided = payload?.[RPC_CORRELATION_FIELD];
    const correlationId = typeof provided === 'string' && provided ? provided : randomUUID();

    if (payload) delete payload[RPC_CORRELATION_FIELD];

    this.logger.debug(
      `[${correlationId}] ${context.getClass().name}.${context.getHandler().name}`,
    );

    return new Observable((subscriber) => {
      RequestContext.run({ correlationId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}

import {
  CallHandler,
  ExecutionContext,
  GatewayTimeoutException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/**
 * Techo de duración por petición en el borde. Complementa al circuit breaker:
 * el breaker acota la llamada a un dependiente, esto acota la petición completa
 * para que un handler colgado no retenga la conexión del cliente.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly ms = 10_000) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.ms),
      catchError((error) =>
        throwError(() =>
          error instanceof TimeoutError
            ? new GatewayTimeoutException('La petición excedió el tiempo máximo')
            : error,
        ),
      ),
    );
  }
}

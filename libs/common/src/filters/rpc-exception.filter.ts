import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { throwError } from 'rxjs';
import { DomainError } from './domain.errors';
import { UPSTREAM_UNAVAILABLE_ERROR, isTransportFailure } from './transport-failure';

export interface SerializedRpcError {
  code: string;
  message: string;
  httpStatus: number;
  details?: Record<string, unknown>;
}

/**
 * Filtro de los microservicios.
 *
 * Sin esto, un error lanzado dentro de un handler @MessagePattern llega al
 * llamador como un objeto vacío y pierde causa y status. Acá todo error se
 * normaliza a `SerializedRpcError`, que el gateway sabe volver a convertir en
 * respuesta HTTP.
 */
@Catch()
export class AllRpcExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllRpcExceptionsFilter.name);

  catch(exception: unknown, _host: ArgumentsHost) {
    const serialized = this.serialize(exception);

    if (serialized.httpStatus >= 500) {
      this.logger.error(
        `${serialized.code}: ${serialized.message}`,
        (exception as Error)?.stack,
      );
    } else {
      this.logger.warn(`${serialized.code}: ${serialized.message}`);
    }

    return throwError(() => new RpcException(serialized).getError());
  }

  private isSerializedRpcError(value: unknown): value is SerializedRpcError {
    return (
      typeof value === 'object' &&
      value !== null &&
      'code' in value &&
      'httpStatus' in value &&
      typeof (value as SerializedRpcError).httpStatus === 'number' &&
      'message' in value
    );
  }

  private serialize(exception: unknown): SerializedRpcError {
    if (exception instanceof DomainError) {
      return this.fromDomainError(exception);
    }

    // Un error que YA viene serializado desde otro servicio se repropaga intacto.
    // Sin esto, un 403 legítimo de tickets-service cruzaba el BFF y llegaba al
    // cliente como 500 — además de contar como fallo de infraestructura y
    // empujar el circuito del BFF hacia OPEN, que es un DoS barato: bastaba
    // repetir lecturas no autorizadas para degradar el servicio de todos.
    if (this.isSerializedRpcError(exception)) {
      return exception;
    }

    // Un dependiente caído del propio microservicio (p. ej. el BFF hacia
    // tickets-service) se propaga como 503 y no como 500: el llamador necesita
    // distinguir "fallo temporal aguas abajo" de "bug en este servicio".
    if (isTransportFailure(exception)) {
      return { ...UPSTREAM_UNAVAILABLE_ERROR };
    }

    // Circuit breaker abierto y demás excepciones HTTP conservan su status al
    // cruzar el transporte.
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof RpcException) {
      return this.fromRpcException(exception);
    }

    // Cualquier otra cosa es un bug nuestro: mensaje genérico hacia afuera,
    // detalle completo en el log del servicio.
    return this.fromUnknown();
  }

  private fromDomainError(exception: DomainError): SerializedRpcError {
    return {
      code: exception.code,
      message: exception.message,
      httpStatus: exception.httpStatus,
      details: exception.details,
    };
  }

  private fromHttpException(exception: HttpException): SerializedRpcError {
    const payload = exception.getResponse();
    const payloadObject =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)
        : undefined;

    return {
      code: payloadObject && 'code' in payloadObject ? String(payloadObject.code) : 'UPSTREAM_ERROR',
      message: typeof payload === 'string' ? payload : (payloadObject?.message as string) ?? exception.message,
      httpStatus: exception.getStatus(),
      details: payloadObject,
    };
  }

  private fromRpcException(exception: RpcException): SerializedRpcError {
    const error = exception.getError();
    if (typeof error === 'object' && error !== null && 'code' in error) {
      return error as SerializedRpcError;
    }
    return {
      code: 'RPC_ERROR',
      message: typeof error === 'string' ? error : 'Error en el microservicio',
      httpStatus: 400,
    };
  }

  private fromUnknown(): SerializedRpcError {
    return {
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servicio',
      httpStatus: 500,
    };
  }
}

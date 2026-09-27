import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from './domain.errors';
import { SerializedRpcError } from './rpc-exception.filter';
import { isTransportFailure } from './transport-failure';

export interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  path: string;
  timestamp: string;
  correlationId?: string;
}

/**
 * Filtro del borde HTTP (gateway).
 *
 * Reconstruye el error que viajó desde un microservicio como
 * `SerializedRpcError` y le devuelve su status original, en vez de colapsar
 * todo a 500. También impide que un stack trace salga al cliente en producción.
 */
@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.toResponseBody(exception, request);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${body.code}: ${body.message}`,
        (exception as Error)?.stack,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${body.code}: ${body.message}`);
    }

    response.status(body.statusCode).json(body);
  }

  private toResponseBody(exception: unknown, request: Request): ErrorResponseBody {
    const base = {
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    };

    if (exception instanceof DomainError) {
      return {
        ...base,
        statusCode: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (this.isSerializedRpcError(exception)) {
      return {
        ...base,
        statusCode: exception.httpStatus,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as Record<string, unknown>).message as string) ?? exception.message;

      return {
        ...base,
        statusCode: exception.getStatus(),
        code:
          typeof payload === 'object' && payload !== null && 'code' in payload
            ? String((payload as Record<string, unknown>).code)
            : this.codeFromStatus(exception.getStatus()),
        message: Array.isArray(message) ? message.join('; ') : message,
        details:
          typeof payload === 'object' && payload !== null
            ? (payload as Record<string, unknown>)
            : undefined,
      };
    }

    if (isTransportFailure(exception)) {
      // Un dependiente inalcanzable es 503, no 500: le dice al cliente que el
      // problema es temporal y que reintentar tiene sentido.
      return {
        ...base,
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'Un servicio interno no está disponible temporalmente',
      };
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
    };
  }

  private isSerializedRpcError(value: unknown): value is SerializedRpcError {
    return (
      typeof value === 'object' &&
      value !== null &&
      'code' in value &&
      'httpStatus' in value &&
      'message' in value
    );
  }

  private codeFromStatus(status: number): string {
    return HttpStatus[status] ? String(HttpStatus[status]) : 'HTTP_ERROR';
  }
}

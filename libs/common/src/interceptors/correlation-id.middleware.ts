import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Asigna un correlation id por petición y lo devuelve en la respuesta. Con
 * seis procesos, sin esto no se puede reconstruir el recorrido de un request
 * a partir de los logs.
 *
 * Además de setearlo en los headers, abre el `RequestContext` para el resto
 * del ciclo de vida del request: `UpstreamClient` (y cualquier otro llamante
 * de `withRpcAuth`) lo toma de ahí para adjuntarlo al mensaje RPC saliente,
 * sin que ningún controller tenga que leerlo y reenviarlo a mano.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const correlationId = typeof incoming === 'string' && incoming ? incoming : randomUUID();

    req.headers[CORRELATION_ID_HEADER] = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    RequestContext.run({ correlationId }, next);
  }
}

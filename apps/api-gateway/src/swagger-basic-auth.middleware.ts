import { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Protege /api/docs con autenticación básica.
 *
 * La documentación completa de la API es un mapa de su superficie: cada ruta, cada
 * campo, cada enum. En un ambiente accesible eso no debe quedar público, pero
 * prohibirlo del todo obliga a levantar el proyecto entero en local solo para mirar un
 * contrato. Con credenciales se consulta cuando hace falta y no queda abierto.
 *
 * Se implementa a mano en lugar de sumar una dependencia: son veinte líneas y evita
 * arrastrar un paquete más al proceso expuesto.
 */
export function swaggerBasicAuth(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';

    if (header.startsWith('Basic ')) {
      const provided = Buffer.from(header.slice(6), 'base64');

      // Comparación en tiempo constante, y con el largo verificado aparte porque
      // timingSafeEqual lanza si los buffers difieren en tamaño.
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
        next();
        return;
      }
    }

    // El realm hace que el navegador muestre el diálogo de usuario y contraseña.
    // Sin tildes a propósito: las cabeceras HTTP se interpretan como latin-1, así que
    // un carácter no ASCII acá se ve como mojibake en el diálogo del navegador.
    res.setHeader('WWW-Authenticate', 'Basic realm="Documentacion de Ticketera"');
    res.status(401).send('Se requieren credenciales para ver la documentación');
  };
}

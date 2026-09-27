import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca una ruta como accesible sin token. El guard JWT es global, así que
 * todo es privado por omisión y abrir una ruta es un acto explícito y auditable.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

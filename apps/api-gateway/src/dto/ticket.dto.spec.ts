import { plainToInstance } from 'class-transformer';
import { SearchTicketsDto } from './ticket.dto';

/**
 * Regresión de los filtros booleanos.
 *
 * `@Type(() => Boolean)` convertía `'false'` en `true` (porque `Boolean('false')`
 * es `true`), así que `unassignedOnly=false` filtraba idéntico a `=true` y devolvía
 * resultados incorrectos sin ningún síntoma. Se prueba con las MISMAS opciones de
 * transformación que usa el ValidationPipe del gateway.
 */
describe('SearchTicketsDto: filtros booleanos', () => {
  // Mismas opciones que el ValidationPipe del gateway: sin conversión implícita,
  // porque con ella `'false'` se convertía en `true` pisando el @Transform.
  const parse = (raw: Record<string, unknown>) => plainToInstance(SearchTicketsDto, raw);

  it.each(['unassignedOnly', 'overdueOnly'] as const)('%s="false" es false', (field) => {
    expect(parse({ [field]: 'false' })[field]).toBe(false);
  });

  it.each(['unassignedOnly', 'overdueOnly'] as const)('%s="true" es true', (field) => {
    expect(parse({ [field]: 'true' })[field]).toBe(true);
  });

  it.each(['unassignedOnly', 'overdueOnly'] as const)('%s ausente es undefined', (field) => {
    expect(parse({})[field]).toBeUndefined();
  });

  it('acepta 0 y 1 como booleanos de query string', () => {
    expect(parse({ unassignedOnly: '0' }).unassignedOnly).toBe(false);
    expect(parse({ unassignedOnly: '1' }).unassignedOnly).toBe(true);
  });

  it('un valor no reconocible queda undefined, no se inventa un false', () => {
    expect(parse({ unassignedOnly: 'quizas' }).unassignedOnly).toBeUndefined();
  });
});

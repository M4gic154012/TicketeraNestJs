import { Logger } from '@nestjs/common';

/**
 * Patrón Service Layer.
 *
 * Un caso de uso = una clase con un único método `execute`. La clase orquesta:
 * carga agregados por el repositorio, invoca reglas de dominio, coordina la
 * transacción y publica los eventos resultantes. No contiene reglas de negocio
 * propias (esas viven en el dominio) ni detalles de transporte (esos viven en
 * el controlador).
 *
 * Frente a un "TicketsService" con veinte métodos, esto acota el radio de un
 * cambio: tocar la creación de tickets no puede romper el cierre de tickets.
 */
export abstract class ApplicationService<TCommand, TResult> {
  protected readonly logger = new Logger(this.constructor.name);

  abstract execute(command: TCommand): Promise<TResult>;
}

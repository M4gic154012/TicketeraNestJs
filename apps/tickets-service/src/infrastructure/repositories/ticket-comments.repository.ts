import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TicketComment, TypeOrmBaseRepository } from '@ticketera/database';
import { Repository as OrmRepository } from 'typeorm';

/**
 * Hasta ahora `TicketComment` solo se consultaba dentro del join de detalle
 * de un ticket (`TicketsRepository.findByIdWithDetail`). Este repositorio
 * existe para poder consultarlo directamente por autor, para el dossier de
 * acceso/portabilidad ARCO.
 */
@Injectable()
export class TicketCommentsRepository extends TypeOrmBaseRepository<TicketComment> {
  constructor(@InjectRepository(TicketComment) orm: OrmRepository<TicketComment>) {
    super(orm, 'comment');
  }

  protected get sortableColumns(): string[] {
    return ['createdAt'];
  }

  protected get defaultSortColumn(): string {
    return 'createdAt';
  }

  /** Un comentario sin saber a qué ticket pertenece no sirve en un dossier. */
  protected get defaultRelations(): string[] {
    return ['ticket'];
  }
}

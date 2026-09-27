import { Injectable } from '@nestjs/common';
import { PagedResponseDto } from '@ticketera/common';
import { Ticket } from '@ticketera/database';
import { ApplicationService, Specification } from '@ticketera/patterns';
import {
  AllTicketsSpec,
  OverdueTicketSpec,
  TicketAssignedToSpec,
  TicketByCategorySpec,
  TicketByPrioritySpec,
  TicketByStatusSpec,
  TicketByTagSpec,
  TicketCreatedBetweenSpec,
  TicketRequestedBySpec,
  TicketTextSearchSpec,
  UnassignedTicketSpec,
} from '../../domain/specifications';
import { TicketsRepository } from '../../infrastructure/repositories';
import { SearchTicketsQuery, TicketSummaryView, toTicketSummary } from '../dto';

/**
 * Caso de uso: búsqueda de tickets.
 *
 * Aquí se ve el rédito del patrón Specification: cada filtro opcional es una
 * clase que se compone sobre la anterior. La alternativa sería un QueryBuilder
 * con una docena de `if (filtro) qb.andWhere(...)` que crece sin control y no se
 * puede testear por partes.
 */
@Injectable()
export class SearchTicketsUseCase extends ApplicationService<
  SearchTicketsQuery,
  PagedResponseDto<TicketSummaryView>
> {
  constructor(private readonly tickets: TicketsRepository) {
    super();
  }

  async execute(query: SearchTicketsQuery): Promise<PagedResponseDto<TicketSummaryView>> {
    const spec = this.buildSpecification(query);

    const page = await this.tickets.findPaged(spec, {
      page: query.page,
      pageSize: query.pageSize,
      orderBy: query.orderBy,
      order: query.order,
    });

    return PagedResponseDto.from(
      page.items.map(toTicketSummary),
      page.total,
      page.page,
      page.pageSize,
    );
  }

  private buildSpecification(query: SearchTicketsQuery): Specification<Ticket> {
    let spec: Specification<Ticket> = new AllTicketsSpec();

    if (query.statuses?.length) spec = spec.and(new TicketByStatusSpec(query.statuses));
    if (query.priorities?.length) spec = spec.and(new TicketByPrioritySpec(query.priorities));
    if (query.category) spec = spec.and(new TicketByCategorySpec(query.category));
    if (query.assigneeId) spec = spec.and(new TicketAssignedToSpec(query.assigneeId));
    if (query.requesterId) spec = spec.and(new TicketRequestedBySpec(query.requesterId));
    if (query.unassignedOnly) spec = spec.and(new UnassignedTicketSpec());
    if (query.overdueOnly) spec = spec.and(new OverdueTicketSpec());
    if (query.tag) spec = spec.and(new TicketByTagSpec(query.tag));
    if (query.text?.trim()) spec = spec.and(new TicketTextSearchSpec(query.text.trim()));

    // Rango abierto por cualquiera de los dos extremos. Antes exigía ambos y, si
    // faltaba uno, DESCARTABA el filtro en silencio: `createdFrom=2099-01-01`
    // devolvía la tabla entera en lugar de nada.
    if (query.createdFrom || query.createdTo) {
      spec = spec.and(
        new TicketCreatedBetweenSpec(
          query.createdFrom ? new Date(query.createdFrom) : undefined,
          query.createdTo ? new Date(query.createdTo) : undefined,
        ),
      );
    }

    return spec;
  }
}

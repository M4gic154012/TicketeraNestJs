import { Injectable } from '@nestjs/common';
import { assertCanAccess } from '@ticketera/common';
import { ApplicationService } from '@ticketera/patterns';
import { DataSubjectRequestsRepository } from '../../infrastructure/repositories';
import { DataSubjectRequestView, ListDataSubjectRequestsQuery, toDataSubjectRequestView } from '../dto';

/**
 * Soporte del dossier de Acceso: el titular debe poder ver qué gestiones se
 * le hicieron, no solo sus datos actuales.
 */
@Injectable()
export class ListDataSubjectRequestsUseCase extends ApplicationService<
  ListDataSubjectRequestsQuery,
  DataSubjectRequestView[]
> {
  constructor(private readonly requests: DataSubjectRequestsRepository) {
    super();
  }

  async execute(query: ListDataSubjectRequestsQuery): Promise<DataSubjectRequestView[]> {
    assertCanAccess({ id: query.actorId, role: query.actorRole }, query.subjectId);

    const requests = await this.requests.findBySubject(query.subjectId);
    return requests.map(toDataSubjectRequestView);
  }
}

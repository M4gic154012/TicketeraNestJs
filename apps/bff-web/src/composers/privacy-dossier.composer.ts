import { Injectable } from '@nestjs/common';
import {
  NOTIFICATIONS_PATTERNS,
  TICKETS_PATTERNS,
  USERS_PATTERNS,
  UserRole,
  assertCanAccess,
} from '@ticketera/common';
import { ServiceClients } from '../clients/service.clients';

export interface PrivacyDossierRequest {
  subjectId: string;
  requestedById: string;
  requestedByRole: UserRole;
}

interface TicketPage {
  items: unknown[];
  total: number;
}

const emptyPage = (): TicketPage & { page: number; pageSize: number; totalPages: number } => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 0,
  totalPages: 0,
});

/** Tope de páginas de un mismo filtro, para que un bug de conteo no vuelva la exportación un loop. */
const MAX_TICKET_PAGES = 50;
const TICKET_PAGE_SIZE = 1000;
const NOTIFICATIONS_HARD_CAP = 5_000;

/**
 * Dossier de Acceso + Portabilidad ARCO: agrega en un solo JSON estructurado
 * el perfil, los tickets, los comentarios y las notificaciones de un titular.
 * La ley no exige un formato distinto para portabilidad, así que sirve para
 * ambos derechos.
 *
 * Fallbacks con criterio explícito: `ticketsAsRequester`/`ticketsAsAssignee`/
 * `commentsWritten`/`notificationsReceived` degradan a vacío si el servicio no
 * responde (no tienen autorización propia distinta de "pudiste pedir el
 * dossier"). El `profile` y `requestHistory` NO llevan fallback — si el
 * dossier no está autorizado, el composer entero debe fallar, no esconder un
 * 403 real detrás de un dossier parcial vacío.
 *
 * Completitud, no solo disponibilidad: los tickets se paginan hasta agotar
 * `total` (antes se pedía una sola página de 1000 y el resto se perdía en
 * silencio para cualquier titular con más historial que eso — Acceso y
 * Portabilidad exigen el conjunto completo, no una muestra). Las notificaciones
 * SÍ tienen un tope real de 5000 en `notifications-service` que este composer
 * no puede levantar sin cambiar ese contrato RPC; para no volver a truncar en
 * silencio, `notificationsReceived.truncated` lo declara explícitamente en vez
 * de que el titular tenga que adivinarlo comparando cuentas a mano.
 *
 * `assertCanAccess` se evalúa ACÁ, no solo en `users-service`: `profile` sale
 * de `GetUserUseCase` (`USERS_PATTERNS.findById`), un lookup genérico sin
 * actor que usan otros llamantes (auth, joins de detalle) y que por eso no
 * puede ni debe decidir autorización de privacidad. Sin este chequeo, la
 * única defensa sería el `@Roles(ADMIN)` del gateway en la ruta asistida — el
 * mismo patrón de falla ("el gateway ya filtró") que motivó volver
 * fail-closed la autorización de tickets.
 */
@Injectable()
export class PrivacyDossierComposer {
  constructor(private readonly services: ServiceClients) {}

  async compose(request: PrivacyDossierRequest) {
    assertCanAccess(
      { id: request.requestedById, role: request.requestedByRole },
      request.subjectId,
    );

    const profile = await this.services.users(USERS_PATTERNS.findById, {
      id: request.subjectId,
    });

    const [ticketsAsRequester, ticketsAsAssignee, commentsWritten, notificationsReceived, requestHistory] =
      await Promise.all([
        this.fetchAllTickets({ requesterId: request.subjectId }),
        this.fetchAllTickets({ assigneeId: request.subjectId }),
        this.services.tickets(
          TICKETS_PATTERNS.findCommentsByAuthor,
          { authorId: request.subjectId },
          () => [],
        ),
        this.fetchNotifications(request.subjectId),
        this.services.users(USERS_PATTERNS.listDataSubjectRequests, {
          actorId: request.requestedById,
          actorRole: request.requestedByRole,
          subjectId: request.subjectId,
        }),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      subject: profile,
      ticketsAsRequester,
      ticketsAsAssignee,
      commentsWritten,
      notificationsReceived,
      requestHistory,
    };
  }

  /**
   * Pagina `TICKETS_PATTERNS.search` hasta juntar `total` items o hasta el
   * tope de seguridad. Si la primera página ya degrada (circuito abierto), no
   * hay `total` del que fiarse: se devuelve vacío tal cual hacía antes, sin
   * intentar páginas siguientes contra un servicio que ya avisó que no responde.
   */
  private async fetchAllTickets(
    filters: Record<string, unknown>,
  ): Promise<{ items: unknown[]; total: number; truncated: boolean }> {
    const first = await this.services.tickets<TicketPage>(
      TICKETS_PATTERNS.search,
      { ...filters, page: 1, pageSize: TICKET_PAGE_SIZE },
      emptyPage,
    );

    const items = [...first.items];
    let page = 1;

    while (items.length < first.total && page < MAX_TICKET_PAGES) {
      page++;
      const next = await this.services.tickets<TicketPage>(
        TICKETS_PATTERNS.search,
        { ...filters, page, pageSize: TICKET_PAGE_SIZE },
        emptyPage,
      );
      if (next.items.length === 0) break; // degradó a mitad de la paginación: no sigas pidiendo.
      items.push(...next.items);
    }

    return { items, total: first.total, truncated: items.length < first.total };
  }

  private async fetchNotifications(
    subjectId: string,
  ): Promise<{ items: unknown[]; unreadCount: number; total: number; truncated: boolean }> {
    const result = await this.services.notifications<{
      items: unknown[];
      unreadCount: number;
      total: number;
    }>(
      NOTIFICATIONS_PATTERNS.findForUser,
      { recipientId: subjectId, onlyUnread: false, limit: NOTIFICATIONS_HARD_CAP },
      () => ({ items: [], unreadCount: 0, total: 0 }),
    );

    return { ...result, truncated: result.total > result.items.length };
  }
}

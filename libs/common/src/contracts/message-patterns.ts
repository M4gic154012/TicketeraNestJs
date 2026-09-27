/**
 * Contrato de transporte entre procesos. Es la única fuente de verdad de los
 * nombres de mensaje: gateway, BFF y microservicios importan de acá, así que un
 * rename rompe en compilación y no en runtime.
 *
 * Convención: `<servicio>.<recurso>.<acción>`.
 */
export const USERS_PATTERNS = {
  findById: 'users.user.find-by-id',
  findByEmail: 'users.user.find-by-email',
  findMany: 'users.user.find-many',
  create: 'users.user.create',
  validateCredentials: 'users.auth.validate-credentials',
  findOrCreateByEmail: 'users.user.find-or-create-by-email',
  // Derechos ARCO + portabilidad + bloqueo (Ley 21.719).
  updateProfile: 'users.user.update-profile',
  anonymize: 'users.user.anonymize',
  setPrivacyBlock: 'users.user.set-privacy-block',
  registerOpposition: 'users.user.register-opposition',
  listDataSubjectRequests: 'users.user.list-data-subject-requests',
} as const;

export const TICKETS_PATTERNS = {
  create: 'tickets.ticket.create',
  findById: 'tickets.ticket.find-by-id',
  findByCode: 'tickets.ticket.find-by-code',
  search: 'tickets.ticket.search',
  assign: 'tickets.ticket.assign',
  changeStatus: 'tickets.ticket.change-status',
  addComment: 'tickets.ticket.add-comment',
  breachingSla: 'tickets.ticket.breaching-sla',
  statsByAgent: 'tickets.ticket.stats-by-agent',
  /** Soporte del dossier de acceso/portabilidad ARCO. */
  findCommentsByAuthor: 'tickets.ticket.find-comments-by-author',
} as const;

export const NOTIFICATIONS_PATTERNS = {
  /** Eventos de integración (fire-and-forget, vía emit()). */
  domainEvent: 'notifications.domain-event',
  findForUser: 'notifications.notification.find-for-user',
  markAsRead: 'notifications.notification.mark-as-read',
} as const;

/** Tokens de inyección de los ClientProxy. */
export const USERS_SERVICE = 'USERS_SERVICE';
export const TICKETS_SERVICE = 'TICKETS_SERVICE';
export const NOTIFICATIONS_SERVICE = 'NOTIFICATIONS_SERVICE';
export const BFF_WEB_SERVICE = 'BFF_WEB_SERVICE';

export const EMAIL_INGESTION_SERVICE = 'EMAIL_INGESTION_SERVICE';

export const EMAIL_PATTERNS = {
  /** Dispara una corrida del poller a demanda (útil para probar). */
  pollNow: 'email.mailbox.poll-now',
  /** Bitácora de correos procesados, con el motivo de cada descarte. */
  processedLog: 'email.log.recent',
} as const;

export const BFF_PATTERNS = {
  ticketDetail: 'bff.web.ticket-detail',
  agentDashboard: 'bff.web.agent-dashboard',
  ticketList: 'bff.web.ticket-list',
  createTicket: 'bff.web.create-ticket',
  /** Dossier de acceso/portabilidad ARCO: agrega perfil + tickets + comentarios + notificaciones. */
  privacyDossier: 'bff.web.privacy-dossier',
} as const;

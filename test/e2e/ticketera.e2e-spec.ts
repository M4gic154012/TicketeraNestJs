import request from 'supertest';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const api = () => request(baseUrl);

// La suite necesita más actores (seis identidades distintas: solicitante, dos
// agentes, supervisor, admin y un segundo solicitante) que el propio login
// permite por minuto: `POST /auth/login` está limitado a 5 intentos/min por IP
// (freno a fuerza bruta, ver `auth.controller.ts`). No tiene sentido subir ese
// límite para que la suite pase — es la misma protección que un pentest real
// ejercitaría — así que la suite lo respeta: cachea cada sesión (una sola
// llamada real por identidad para todo el archivo, sin importar cuántos
// describes la usan) y reintenta con backoff ante un 429 en vez de tratarlo
// como una falla.
jest.setTimeout(180_000);

const SEED_PASSWORD = process.env.E2E_PASSWORD ?? 'Ticketera2026';
const LOGIN_MAX_WAIT_MS = 120_000;

interface Session {
  token: string;
  userId: string;
  email: string;
}

async function login(email: string, password = SEED_PASSWORD): Promise<Session> {
  const deadline = Date.now() + LOGIN_MAX_WAIT_MS;
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    const response = await api().post('/api/v1/auth/login').send({ email, password });
    lastStatus = response.status;

    if (response.status === 200 && typeof response.body.accessToken === 'string') {
      return {
        token: response.body.accessToken as string,
        userId: response.body.user.id as string,
        email,
      };
    }

    if (response.status === 429) {
      const retryAfterHeader = Number(response.headers['retry-after']);
      const backoffMs =
        Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
          ? retryAfterHeader * 1000
          : 5_000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    throw new Error(
      `No fue posible autenticar a ${email} para la suite E2E: login respondió ${response.status} ${JSON.stringify(response.body)}`,
    );
  }

  throw new Error(
    `Timeout esperando que se liberara el throttle de login para ${email} (último status: ${lastStatus})`,
  );
}

const sessionCache = new Map<string, Promise<Session>>();

/** Sesión memoizada por email: como máximo una llamada real de login por identidad en todo el archivo. */
function getSession(email: string, password = SEED_PASSWORD): Promise<Session> {
  const cached = sessionCache.get(email);
  if (cached) return cached;

  const promise = login(email, password);
  sessionCache.set(email, promise);
  return promise;
}

function auth(session: Session) {
  return { Authorization: `Bearer ${session.token}` };
}

/**
 * Los eventos de dominio se publican con `emit()` (fire-and-forget) y cruzan
 * gateway → tickets-service → notifications-service por RPC: la notificación no
 * está garantizada en el instante en que la petición HTTP que la originó ya
 * respondió. Se hace polling corto en vez de un `sleep` fijo para no acoplar el
 * test a cuánto tarda el transporte en un ambiente cargado.
 */
async function waitForNotification(
  session: Session,
  predicate: (n: { eventName: string; subject: string; body: string }) => boolean,
  attempts = 20,
  delayMs = 300,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const response = await api()
      .get('/api/v1/notifications')
      .query({ limit: 100 })
      .set(auth(session));

    if (response.status === 200 && (response.body.items ?? []).some(predicate)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(
    `Timeout esperando una notificación para ${session.email} que cumpliera el predicado`,
  );
}

async function countNotificationsFor(
  session: Session,
  predicate: (n: { eventName: string; subject: string; body: string }) => boolean,
): Promise<number> {
  const response = await api()
    .get('/api/v1/notifications')
    .query({ limit: 100 })
    .set(auth(session))
    .expect(200);

  return (response.body.items ?? []).filter(predicate).length;
}

describe('Ticketera API (E2E)', () => {
  let accessToken = '';
  let ticketId = '';

  beforeAll(async () => {
    const response = await api().post('/api/v1/auth/login').send({
      email: process.env.E2E_EMAIL ?? 'usuario@ticketera.local',
      password: SEED_PASSWORD,
    });

    if (response.status !== 200 || typeof response.body.accessToken !== 'string') {
      throw new Error(
        `No fue posible preparar la suite E2E: login respondió ${response.status}`,
      );
    }

    accessToken = response.body.accessToken;
  });

  it('expone liveness sin autenticación', async () => {
    const response = await api().get('/api/v1/health/live').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
      }),
    );
    expect(response.body).toHaveProperty('uptime');
  });

  it('expone readiness cuando las dependencias están disponibles', async () => {
    const response = await api().get('/api/v1/health/ready').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      openCircuits: 0,
    });
  });

  it('rechaza el perfil sin token', async () => {
    await api().get('/api/v1/users/me').expect(401);
  });

  it('autentica al usuario seed y devuelve tokens', async () => {
    const response = await api()
      .post('/api/v1/auth/login')
      .send({
        email: process.env.E2E_EMAIL ?? 'usuario@ticketera.local',
        password: SEED_PASSWORD,
      })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: expect.any(String),
        user: expect.objectContaining({
          email: process.env.E2E_EMAIL ?? 'usuario@ticketera.local',
          role: 'REQUESTER',
        }),
      }),
    );
  });

  it('consulta el perfil autenticado', async () => {
    const response = await api()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        email: process.env.E2E_EMAIL ?? 'usuario@ticketera.local',
        role: 'REQUESTER',
      }),
    );
  });

  it('crea y consulta un ticket atravesando gateway, RPC y persistencia', async () => {
    const response = await api()
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: `Prueba E2E ${Date.now()}`,
        description: 'Ticket creado por la suite de pruebas end to end.',
        category: 'SOFTWARE',
        autoAssign: false,
      })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        code: expect.any(String),
        status: 'OPEN',
      }),
    );
    ticketId = response.body.id;

    const detail = await api()
      .get(`/api/v1/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(detail.body).toEqual(
      expect.objectContaining({
        ticket: expect.objectContaining({
          id: ticketId,
          requester: expect.objectContaining({
            id: expect.any(String),
          }),
        }),
        permissions: expect.any(Object),
      }),
    );
  });
});

/**
 * Escenario 1 del CLAUDE.md: ciclo de vida completo con los cuatro actores,
 * verificando el DESTINATARIO de cada notificación (no solo que exista una).
 * Es justo lo que la suite unitaria no puede ver: `forStatusChanged` y
 * `forCommented` son funciones puras testeadas con mocks, pero el bug real
 * (notificar a `changedById`/`authorId` en vez del interesado) solo se hace
 * visible atravesando gateway → tickets-service → notifications-service y
 * leyendo la bandeja de cada actor por HTTP.
 */
describe('Ciclo de vida completo con los cuatro actores y notificaciones', () => {
  let requester: Session;
  let stranger: Session;
  let assignedAgent: Session;
  let unrelatedAgent: Session;
  let supervisor: Session;
  let admin: Session;
  let ticketId: string;
  let ticketCode: string;

  beforeAll(async () => {
    [requester, assignedAgent, unrelatedAgent, supervisor, admin] = await Promise.all([
      getSession('usuario@ticketera.local'),
      getSession('agente.software@ticketera.local'), // skill SOFTWARE
      getSession('agente.redes@ticketera.local'), // skill NETWORK/HARDWARE, sin relación con este ticket
      getSession('supervisor@ticketera.local'),
      getSession('admin@ticketera.local'),
    ]);

    // Un segundo solicitante, sin relación con el ticket que crea `requester`, para
    // probar el caso de IDOR de la sección de seguridad: un tercero autenticado no
    // puede comentar ni cambiar el estado de un ticket ajeno con solo su UUID.
    const strangerEmail = `stranger.e2e.${Date.now()}@ticketera.local`;
    await api()
      .post('/api/v1/users')
      .set(auth(admin))
      .send({
        email: strangerEmail,
        fullName: 'Tercero E2E',
        password: 'ClaveSegura2026',
        role: 'REQUESTER',
      })
      .expect(201);
    stranger = await getSession(strangerEmail, 'ClaveSegura2026');
  });

  it('crea un ticket SOFTWARE con autoAssign y lo asigna al agente con la skill', async () => {
    const response = await api()
      .post('/api/v1/tickets')
      .set(auth(requester))
      .send({
        title: `Ciclo de vida E2E ${Date.now()}`,
        description: 'El correo institucional dejó de sincronizar esta mañana.',
        category: 'SOFTWARE',
        autoAssign: true,
      })
      .expect(201);

    ticketId = response.body.id;
    ticketCode = response.body.code;
    expect(response.body.status).toBe('ASSIGNED');

    const detail = await api()
      .get(`/api/v1/tickets/${ticketId}`)
      .set(auth(requester))
      .expect(200);
    expect(detail.body.ticket.assignee?.id).toBe(assignedAgent.userId);
  });

  it('notifica al solicitante la creación del ticket (no a nadie más)', async () => {
    await waitForNotification(
      requester,
      (n) => n.eventName === 'ticket.created' && n.subject.includes(ticketCode),
    );
  });

  it('el agente asignado cambia el estado y solo el solicitante es notificado (no el propio agente)', async () => {
    await api()
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set(auth(assignedAgent))
      .send({ status: 'IN_PROGRESS' })
      .expect(200);

    await waitForNotification(
      requester,
      (n) => n.eventName === 'ticket.status-changed' && n.subject.includes(ticketCode),
    );

    // Regresión directa del bug documentado: antes se notificaba a `changedById`.
    // Acotado por `ticketCode` (no solo por 'IN_PROGRESS') para no contaminarse con
    // notificaciones de otras corridas de la suite sobre otros tickets.
    const selfNotifications = await countNotificationsFor(
      assignedAgent,
      (n) => n.eventName === 'ticket.status-changed' && n.subject.includes(ticketCode),
    );
    expect(selfNotifications).toBe(0);
  });

  it('un agente sin relación con el ticket no puede cambiarle el estado (403)', async () => {
    await api()
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set(auth(unrelatedAgent))
      .send({ status: 'WAITING_CUSTOMER' })
      .expect(403);
  });

  it('un agente sin relación con el ticket SÍ puede comentarlo (es personal de soporte)', async () => {
    await api()
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .set(auth(unrelatedAgent))
      .send({ body: 'Nota de soporte cruzada, sin estar asignado.' })
      .expect(201);
  });

  it('un tercero solicitante SIN relación con el ticket no puede comentarlo (403, IDOR)', async () => {
    await api()
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .set(auth(stranger))
      .send({ body: 'Intento de comentar un ticket ajeno.' })
      .expect(403);
  });

  it('un tercero solicitante tampoco puede cerrar el ticket ajeno (403, IDOR)', async () => {
    await api()
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set(auth(stranger))
      .send({ status: 'CLOSED' })
      .expect(403);
  });

  it('el agente comenta y el aviso llega al solicitante, no al propio autor', async () => {
    const excerpt = `Diagnóstico ${Date.now()}`;
    await api()
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .set(auth(assignedAgent))
      .send({ body: excerpt })
      .expect(201);

    await waitForNotification(
      requester,
      (n) => n.eventName === 'ticket.commented' && n.body.includes(excerpt),
    );

    const selfNotifications = await countNotificationsFor(
      assignedAgent,
      (n) => n.eventName === 'ticket.commented' && n.body.includes(excerpt),
    );
    expect(selfNotifications).toBe(0);
  });

  it('una nota interna del agente NO genera aviso al solicitante', async () => {
    const excerpt = `Nota interna ${Date.now()}`;
    await api()
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .set(auth(assignedAgent))
      .send({ body: excerpt, isInternal: true })
      .expect(201);

    // Se espera lo mismo que tarda una notificación real en llegar, y se afirma
    // la ausencia: si el aviso existiera, ya habría aparecido en ese margen.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const leaked = await countNotificationsFor(
      requester,
      (n) => n.eventName === 'ticket.commented' && n.body.includes(excerpt),
    );
    expect(leaked).toBe(0);
  });

  it('el solicitante responde y el aviso llega al agente asignado', async () => {
    const excerpt = `Respuesta del solicitante ${Date.now()}`;
    await api()
      .post(`/api/v1/tickets/${ticketId}/comments`)
      .set(auth(requester))
      .send({ body: excerpt })
      .expect(201);

    await waitForNotification(
      assignedAgent,
      (n) => n.eventName === 'ticket.commented' && n.body.includes(excerpt),
    );
  });

  it('una transición ilegal para el solicitante (según el estado de origen) da 409 con las alternativas', async () => {
    // El agente mueve el ticket a WAITING_CUSTOMER. Desde ahí la máquina de estados
    // (ALLOWED_STATUS_TRANSITIONS) solo permite IN_PROGRESS o RESOLVED; y de esos
    // dos, REQUESTER_TRANSITIONS solo le reconoce al solicitante IN_PROGRESS (RESOLVED
    // es una declaración que le corresponde al equipo de soporte, no a él). La
    // intersección de ambas tablas dejan al solicitante con una única alternativa.
    await api()
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set(auth(assignedAgent))
      .send({ status: 'WAITING_CUSTOMER' })
      .expect(200);

    const response = await api()
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set(auth(requester))
      .send({ status: 'RESOLVED' })
      .expect(409);

    expect(response.body.details?.allowed ?? response.body.allowed).toEqual(['IN_PROGRESS']);
  });

  it('el solicitante sí puede devolver el ticket a IN_PROGRESS desde WAITING_CUSTOMER', async () => {
    await api()
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set(auth(requester))
      .send({ status: 'IN_PROGRESS' })
      .expect(200);
  });

  it('un supervisor puede operar sobre un ticket con el que no tiene relación', async () => {
    await api()
      .patch(`/api/v1/tickets/${ticketId}/status`)
      .set(auth(supervisor))
      .send({ status: 'RESOLVED' })
      .expect(200);
  });
});

/**
 * Escenario 3 del CLAUDE.md: idempotencia. Asignar a quien ya está asignado debe
 * ser un no-op — sin eso, varios clics sobre "asignar" generan varios avisos al
 * mismo agente. El índice único de notificaciones no alcanza para probarlo (cada
 * evento trae un `eventId` propio), así que hay que mirar el efecto observable:
 * cuántas notificaciones de asignación recibió el agente.
 */
describe('Idempotencia de la asignación', () => {
  let requester: Session;
  let supervisor: Session;
  let agent: Session;
  let ticketId: string;

  beforeAll(async () => {
    [requester, supervisor, agent] = await Promise.all([
      getSession('usuario@ticketera.local'),
      getSession('supervisor@ticketera.local'),
      getSession('agente.software@ticketera.local'),
    ]);
  });

  it('asignar dos veces al mismo agente no duplica el aviso de asignación', async () => {
    const created = await api()
      .post('/api/v1/tickets')
      .set(auth(requester))
      .send({
        title: `Idempotencia E2E ${Date.now()}`,
        description: 'Verifica que reasignar al mismo agente sea un no-op.',
        category: 'SOFTWARE',
        autoAssign: false,
      })
      .expect(201);
    ticketId = created.body.id;

    await api()
      .post(`/api/v1/tickets/${ticketId}/assign`)
      .set(auth(supervisor))
      .send({ assigneeId: agent.userId })
      .expect(201);

    await waitForNotification(
      agent,
      (n) => n.eventName === 'ticket.assigned' && n.body.includes(created.body.code),
    );

    await api()
      .post(`/api/v1/tickets/${ticketId}/assign`)
      .set(auth(supervisor))
      .send({ assigneeId: agent.userId })
      .expect(201);

    // Margen para que, si el no-op fallara, la segunda notificación alcance a
    // llegar antes de contar.
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const count = await countNotificationsFor(
      agent,
      (n) => n.eventName === 'ticket.assigned' && n.body.includes(created.body.code),
    );
    expect(count).toBe(1);
  });

  it('dos asignaciones concurrentes al mismo agente no dejan el ticket en un estado inconsistente', async () => {
    const created = await api()
      .post('/api/v1/tickets')
      .set(auth(requester))
      .send({
        title: `Concurrencia E2E ${Date.now()}`,
        description: 'Dos POST /assign concurrentes contra el mismo ticket.',
        category: 'SOFTWARE',
        autoAssign: false,
      })
      .expect(201);

    const results = await Promise.all([
      api()
        .post(`/api/v1/tickets/${created.body.id}/assign`)
        .set(auth(supervisor))
        .send({ assigneeId: agent.userId }),
      api()
        .post(`/api/v1/tickets/${created.body.id}/assign`)
        .set(auth(supervisor))
        .send({ assigneeId: agent.userId }),
    ]);

    // El lock pesimista serializa las dos escrituras: ninguna debe fallar por
    // contención, y las dos terminan reportando el mismo asignado.
    for (const result of results) {
      expect(result.status).toBe(201);
      expect(result.body.assignee?.id).toBe(agent.userId);
    }

    const detail = await api()
      .get(`/api/v1/tickets/${created.body.id}`)
      .set(auth(supervisor))
      .expect(200);
    expect(detail.body.ticket.assignee.id).toBe(agent.userId);
  });
});

/**
 * Escenario 2 del CLAUDE.md (parcial, sin apagar un contenedor): un 4xx no es una
 * caída. Repetir lecturas/escrituras no autorizadas no debe abrir ningún circuito
 * — si lo hiciera, un usuario autenticado sin ningún privilegio especial podría
 * dejar sin servicio al resto con una única cuenta y cero credenciales robadas.
 */
describe('Los 4xx no cuentan contra el circuit breaker', () => {
  it('repetir cambios de estado no autorizados no abre ningún circuito', async () => {
    const [requester, unrelatedAgent] = await Promise.all([
      getSession('usuario@ticketera.local'),
      getSession('agente.redes@ticketera.local'),
    ]);

    const created = await api()
      .post('/api/v1/tickets')
      .set(auth(requester))
      .send({
        title: `Ruido 403 E2E ${Date.now()}`,
        description: 'Blanco de lecturas/escrituras no autorizadas repetidas.',
        category: 'SOFTWARE',
        autoAssign: false,
      })
      .expect(201);

    const attempts = Array.from({ length: 12 }, () =>
      api()
        .patch(`/api/v1/tickets/${created.body.id}/status`)
        .set(auth(unrelatedAgent))
        .send({ status: 'IN_PROGRESS' }),
    );
    const responses = await Promise.all(attempts);
    expect(responses.every((r) => r.status === 403)).toBe(true);

    const health = await api().get('/api/v1/health/ready').expect(200);
    expect(health.body).toEqual({ status: 'ok', openCircuits: 0 });
  });
});

/**
 * Regresión puntual de QA: `unassignedOnly=false` se convertía con
 * `Boolean('false') === true` y filtraba idéntico a `=true`. Se prueba contra la
 * API real y no contra el DTO aislado porque el bug vivía en la combinación
 * `ValidationPipe` + `@Transform`, no en el campo por separado.
 */
describe('Filtros de búsqueda de tickets', () => {
  it('unassignedOnly=false no descarta los tickets ya asignados', async () => {
    const [requester, supervisor] = await Promise.all([
      getSession('usuario@ticketera.local'),
      getSession('supervisor@ticketera.local'),
    ]);

    const created = await api()
      .post('/api/v1/tickets')
      .set(auth(requester))
      .send({
        title: `Filtro unassignedOnly E2E ${Date.now()}`,
        description: 'Ticket que se asigna para verificar el filtro invertido.',
        category: 'SOFTWARE',
        autoAssign: true,
      })
      .expect(201);
    expect(created.body.status).toBe('ASSIGNED');

    const response = await api()
      .get('/api/v1/tickets')
      .query({ unassignedOnly: 'false' })
      .set(auth(supervisor))
      .expect(200);

    const ids = (response.body.items ?? []).map((t: { id: string }) => t.id);
    expect(ids).toContain(created.body.id);
  });

  it('createdFrom sin createdTo acota el rango en vez de devolver la tabla entera', async () => {
    const supervisor = await getSession('supervisor@ticketera.local');

    const response = await api()
      .get('/api/v1/tickets')
      .query({ createdFrom: '2099-01-01T00:00:00.000Z' })
      .set(auth(supervisor))
      .expect(200);

    expect(response.body.items ?? []).toEqual([]);
  });
});

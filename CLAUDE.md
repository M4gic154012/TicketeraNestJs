# CLAUDE.md

Guía de trabajo para este repositorio. Léela antes de tocar código: describe la
arquitectura real, dónde va cada cosa y qué decisiones ya están tomadas.

## Qué es este proyecto

Backend de una **mesa de ayuda (ticketera)**: los usuarios reportan incidencias,
el sistema las clasifica, les calcula un SLA, las asigna a un agente y notifica
a los involucrados en cada cambio.

Stack: **NestJS 11 + TypeScript + PostgreSQL 16 + TypeORM**, en monorepo Nest con
cinco procesos que se comunican por **transporte TCP** de `@nestjs/microservices`.

## Arquitectura

```
                    HTTP (único puerto expuesto: 3000)
                              │
                    ┌─────────▼─────────┐
                    │    api-gateway    │  CORS, helmet, rate limit, JWT,
                    │  (borde HTTP)     │  validación, correlation-id,
                    └────┬─────────┬────┘  circuit breaker, Swagger
                         │         │
            lecturas de  │         │  escrituras simples
            pantalla     │         └──────────────┐
                    ┌────▼──────┐                 │
                    │  bff-web  │  composición    │
                    │  (TCP     │  por pantalla   │
                    │   4001)   │                 │
                    └──┬──┬──┬──┘                 │
          ┌────────────┘  │  └────────────┐       │
          │               │               │       │
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼───────▼────┐
   │users-service│ │notifications│ │  tickets-service   │
   │  (TCP 4101) │ │ (TCP 4103)  │ │    (TCP 4102)      │
   └──────┬──────┘ └──────┬──────┘ └─────────┬──────────┘
          │               │                  │
          └───────────────┴──────────────────┘
                          │
                  ┌───────▼────────┐
                  │  PostgreSQL    │
                  └────────────────┘
```

**Reglas de la topología** (no las rompas sin discutirlo):

- El **gateway** es el único proceso con HTTP expuesto y el único que conoce el
  secreto de firma del JWT. No tiene acceso a la base de datos.
- El **BFF** no tiene base de datos. Todo lo obtiene por el transporte. Existe
  para componer pantallas, no para agregar un salto de red.
- Las **lecturas de pantalla** van gateway → BFF → servicios. Las **escrituras
  simples** van gateway → servicio dueño, sin pasar por el BFF.
- `tickets-service` **no consulta la tabla `users` para decidir**: le pregunta a
  `users-service` por RPC. La relación `ManyToOne` a `User` existe solo para los
  joins de lectura de las vistas de detalle.
- Los eventos de dominio salen de `tickets-service` hacia `notifications-service`
  con `emit()` (fire-and-forget), nunca con `send()`: notificar no debe bloquear
  la respuesta al usuario.

### Estructura de carpetas

```
apps/
  api-gateway/          borde HTTP: auth/, routes/, dto/
  bff-web/              composers/ (una clase por pantalla), clients/
  users-service/        application/, domain/, infrastructure/
  tickets-service/      el dominio más rico del sistema (ver abajo)
  notifications-service/observadores de eventos de integración
libs/
  common/               contratos entre procesos, DTOs, errores, filtros, config
  database/             entidades TypeORM, migraciones, repositorio base, UoW
  patterns/             implementación agnóstica de los patrones de diseño
docker/                 Dockerfile parametrizado + compose
```

Dentro de un microservicio, siempre las mismas tres capas:

- `domain/` — reglas de negocio: entidades (en `libs/database`), specifications,
  strategies, factories. **No importa nada de `@nestjs/microservices` ni de HTTP.**
- `application/` — un caso de uso por clase (`*.use-case.ts`), más los DTOs de
  entrada/salida. Orquesta; no contiene reglas de negocio.
- `infrastructure/` — repositorios, clientes RPC, observadores, schedulers.

## Los patrones y dónde viven

| Patrón | Contrato en `libs/patterns` | Uso concreto |
|---|---|---|
| **Repository** | `repository/repository.interface.ts` | `TypeOrmBaseRepository` en `libs/database`; `TicketsRepository`, `UsersRepository`, `NotificationsRepository` |
| **Specification** | `specification/` | `apps/tickets-service/src/domain/specifications/`, `apps/users-service/src/domain/specifications/` |
| **Service Layer** | `service-layer/application-service.ts` | todo `application/use-cases/` |
| **Strategy** | `strategy/` | asignación (3 estrategias), SLA (2), canal de notificación (2) |
| **Factory** | `factory/factory.interface.ts` | `TicketFactory`, `UserFactory`, `NotificationFactory` |
| **Observer** | `observer/` | `AggregateRoot` + `DomainEventPublisher` + `IntegrationEventForwarder` + `AuditLogObserver` |
| **Circuit Breaker** | `circuit-breaker/` | `CircuitBreakerRegistry` en gateway, BFF, tickets y notifications |
| **API Gateway** | — | `apps/api-gateway` |
| **BFF** | — | `apps/bff-web` |

### Cómo se usa cada uno (lo que hay que respetar al extender)

**Repository + Specification.** Las consultas por atributos se expresan con
Specifications, **no con un método nuevo de repositorio**. El repositorio solo
suma métodos para lo que una Specification no puede hacer: agregaciones, locks,
secuencias, carga explícita de relaciones.

```ts
// Así se agrega un filtro nuevo: una clase, sin tocar el repositorio.
let spec: Specification<Ticket> = new AllTicketsSpec();
if (query.overdueOnly) spec = spec.and(new OverdueTicketSpec());
const page = await this.tickets.findPaged(spec, { page: 1, pageSize: 20 });
```

Cada Specification implementa **las dos** caras: `isSatisfiedBy` (en memoria,
testeable sin base) y `applyTo` (traduce a SQL). Si solo implementás una, la
regla se duplica más adelante.

**Strategy.** Las estrategias se inyectan como colección vía multi-provider
(`ASSIGNMENT_STRATEGIES`, `SLA_STRATEGIES`, `CHANNEL_STRATEGIES`). Agregar una
estrategia es agregar una clase y sumarla al array del módulo; **no se toca el
resolver ni el caso de uso**. `priority` define el orden de evaluación y
`supports` decide si aplica.

**Factory.** Todo agregado nuevo se construye en su factory, nunca con `new` en
un caso de uso. La factory es dueña de: normalización de entrada, invariantes de
nacimiento, generación del id (hace falta para emitir el evento de creación) y
el primer asiento de historial.

**Observer.** El agregado **acumula** eventos (`this.record(...)`) y la capa de
aplicación los publica **después del commit**:

```ts
const saved = await this.uow.runInTransaction(async (ctx) => { /* ... */ });
await this.events.publishFrom(saved);   // fuera de la transacción, siempre
```

Publicar dentro de la transacción es el error clásico: los observadores
reaccionan a un cambio que todavía puede hacer rollback.

**Circuit Breaker.** Toda llamada saliente a otro proceso va envuelta. Regla
importante: **solo los fallos de infraestructura cuentan** contra el umbral
(`CircuitBreaker.isInfrastructureFailure`). Un 401 o un 409 significan que el
dependiente está sano y respondió bien; contarlos abriría el circuito por culpa
de los usuarios. El `fallback` se usa solo donde una respuesta parcial sea
aceptable — **jamás en login ni en escrituras**.

## Seguridad: invariantes que no se negocian

Una auditoría encontró dos fallas críticas explotables en la primera versión.
Están corregidas; estas reglas existen para que no vuelvan.

**1. La autorización por dato es fail-closed, en el microservicio.**

El gateway valida lo que se puede saber del token (rol). Lo que depende del dato
—¿este ticket es tuyo? ¿estás asignado?— solo lo puede decidir el caso de uso.
Las rutas de comentar y cambiar estado **no llevan `@Roles`** porque el
solicitante legítimo también las usa; por eso la decisión completa vive en
`assertCanChange` / `assertCanComment`.

La falla fue una rama final que *permitía* al "tercero" asumiendo que el gateway
ya había filtrado por rol — y el gateway no lo hacía. Cualquier usuario
autenticado podía cerrar y comentar cualquier ticket con solo conocer su UUID.

Regla: **toda función de autorización termina lanzando**, nunca cayendo al final
sin decidir. Los casos permitidos se enumeran; el resto se rechaza. Está fijado
en `apps/tickets-service/src/application/use-cases/authorization.spec.ts`.

**2. Los mensajes RPC van autenticados con `RPC_SHARED_SECRET`.**

"Solo el gateway está expuesto" era una afirmación sobre el firewall, no sobre el
sistema. Hablando el protocolo TCP de Nest contra el puerto de `users-service` se
podía **crear un usuario ADMIN**, salteándose todos los guards del gateway.

Ahora cada microservicio monta `RpcAuthGuard` como guard global y cada cliente
adjunta el secreto con `withRpcAuth(payload, secret)`. Si agregás un cliente
nuevo, **usá `withRpcAuth`**: sin él el destinatario rechaza el mensaje.
Además los servicios bindean a `MICROSERVICE_BIND_HOST` (por omisión
`127.0.0.1`), no a `0.0.0.0`.

`RPC_SHARED_SECRET` es **distinto** del `JWT_SECRET`: que se filtre uno no debe
comprometer al otro.

**3. Un 4xx no es una caída.**

Dos consecuencias, ambas fueron bugs reales:

- El filtro RPC repropaga intacto un error que ya venía serializado de otro
  servicio. Sin eso, un 403 de `tickets-service` cruzaba el BFF y llegaba como
  500.
- `CircuitBreaker.isInfrastructureFailure` no cuenta los 4xx (salvo 408 y 429).
  Con el 403 convertido en 500 y contado como fallo, **repetir lecturas no
  autorizadas abría el circuito del BFF** y dejaba sin servicio a todos: un DoS
  de costo cero.

**Nota sobre la búsqueda de texto:** `TicketTextSearchSpec` pasa el término como
parámetro (no hay inyección), pero **no escapa los comodines de `ILIKE`**: buscar
`%` o `_` los interpreta como comodín. Es inofensivo — el usuario solo ve tickets
que ya puede ver— pero devuelve resultados que no esperaba. Si alguna vez importa,
se escapan con `ESCAPE`.

**4. Lo que se expone en el borde se decide explícitamente.**

Swagger se publica solo con `ENABLE_SWAGGER=true` (antes bastaba que `NODE_ENV`
no fuera `production`), y **en producción va detrás de autenticación básica**. La
documentación completa es un mapa de la superficie de la API — cada ruta, cada
campo, cada enum — y dejarla abierta en un ambiente accesible es regalarlo; pero
prohibirla del todo obligaba a levantar el proyecto entero en local solo para
mirar un contrato. El esquema **exige** `SWAGGER_USER` y `SWAGGER_PASSWORD`
cuando está habilitado en producción, así que no puede quedar pública por un
olvido: si faltan, el gateway no arranca. `GET /health` detallado requiere SUPERVISOR o ADMIN:
público, filtraba la topología interna y le daba a un atacante señal en tiempo
real de si estaba logrando degradar un servicio. `GET /health/live` sigue público
y liviano para los health checks del orquestador.

## Derechos ARCO (Ley 21.719): hallazgos de auditoría pendientes

Una auditoría de seguridad (2026-09-16, alcance acotado al diff sin commitear de
la funcionalidad ARCO — no cubrió el resto del monorepo) encontró 2 hallazgos
confirmados. Ninguno es crítico ni alto, pero **siguen sin corregirse**: quedan
documentados acá para que no se pierdan y para que el próximo cambio en esta
zona no los repita sin querer.

**1. El bloqueo temporal de privacidad no detiene ningún procesamiento real
(Medium).** `SetPrivacyBlockUseCase` persiste `users.privacyBlockedAt`
correctamente, pero **ningún otro caso de uso, estrategia o specification del
repositorio lo consulta** — confirmado por búsqueda exhaustiva: solo aparece en
ese caso de uso, su test y la migración que crea la columna.
`LeastLoadedAssignmentStrategy` (`apps/tickets-service/src/domain/strategies/
assignment/least-loaded.strategy.ts:25`) sigue asignando tickets a un agente
bloqueado, y `HandleDomainEventUseCase`
(`apps/notifications-service/src/application/use-cases/
handle-domain-event.use-case.ts:44`) lo sigue resolviendo como destinatario de
notificaciones. El derecho que la ley exige (detener el tratamiento) es hoy una
bandera decorativa. Es el mismo tipo de falla que ya pasó con `Boolean('false')`
o con `LOG_LEVEL`/`ENABLE_SWAGGER` en la sección de QA: un campo que existe y se
guarda bien, pero que nadie del lado de lectura consulta. **Fix pendiente:**
excluir candidatos con `isPrivacyBlocked()` en el resolver de asignación y que
`HandleDomainEventUseCase` omita (con traza del motivo) a un destinatario
bloqueado.

**2. El prefijo `"Oposición: "` puede volver a exceder el límite de columna que
la migración `WidenPrivacyBlockReason` acababa de corregir (Informational).**
Esa migración amplió `users.privacyBlockReason` a `varchar(1000)` para igualar
el `@MaxLength(1000)` de `PrivacyBlockDto`/`OppositionRequestDto`. Pero
`RegisterOppositionUseCase.execute` arma el motivo como `` `Oposición:
${command.reason}` `` (11 caracteres de prefijo) **después** de esa validación.
Un motivo de 990-1000 caracteres, válido según el DTO, vuelve a producir el
mismo error de Postgres (`value too long for type character varying(1000)`)
que la migración documenta haber corregido — la misma clase de bug, reabierta
por el prefijo. **Fix pendiente:** bajar el `@MaxLength` del DTO a 989 (o
ampliar la columna 11 caracteres más) y recortar/validar en el caso de uso
antes de persistir.

Reporte completo con trazas, evidencia file:line y pasos de reproducción en
`~/security-audit-skill/ticketera-nestjs/run-1/` (`findings.json`,
`REPORT.md`).

## Base de datos: reglas que salieron de medir, no de intuir

**No existe `migration:generate`, y `synchronize` está en `false` en todos los
entornos.** No es purismo: el schema-builder de TypeORM no puede expresar los
índices GIN/trgm, los parciales ni los funcionales que este esquema usa, así que
su diff **los elimina**. El generador producía un `DROP` de 6 índices más un
`ALTER TYPE ... RENAME` que reescribe `ticket_status_history` completa. Las
migraciones se escriben a mano en `libs/database/src/migrations/`.

**Un índice parcial solo se usa si su predicado es idéntico al de la consulta.**
`ix_tickets_resolution` estaba declarado con `WHERE resolvedAt IS NOT NULL OR
closedAt IS NOT NULL` y la consulta filtra con `COALESCE(...) IS NOT NULL`:
Postgres no deduce la implicación a través del `OR` y hacía Seq Scan. Verificalo
siempre con `EXPLAIN` y `SET enable_seqscan=off` — eso distingue "el planner no
quiere" de "el planner no puede".

**Un `OR` de `ILIKE` necesita que TODAS las ramas sean indexables** para armar un
`BitmapOr`. Faltaba el trgm de `description` y el índice de `title` no se usaba
nunca: costo de escritura puro.

**Nada que salga por la red va dentro de una transacción.** `AssignTicketUseCase`
sostenía el `FOR UPDATE` del ticket durante la llamada a `users-service`, y pedía
una segunda conexión del pool estando dentro de la transacción — con
`DB_POOL_MAX=10`, diez asignaciones concurrentes agotan el pool contra sí mismas.
Ahora: resolver por red primero, después transacción corta que relee con lock.

**El `@VersionColumn` NO protege de lost update.** TypeORM solo verifica la
versión si se lee con `setLock('optimistic', v)`, y acá nadie lo hace: en el
`UPDATE` únicamente incrementa la columna. La defensa real es el lock pesimista
de `findByIdForUpdate`. Si agregás un camino de escritura sobre `Ticket`, **tomá
el lock**; no confíes en `version`.

**Los timeouts están escalonados a propósito**: `lock_timeout` 3 s <
`statement_timeout` 5 s < timeout del circuit breaker. Antes `statement_timeout`
era 15 s contra un breaker de 3 s, así que el gateway abandonaba y la consulta
seguía ocupando conexión y lock por 12 s más haciendo trabajo que nadie iba a leer.

**Hay respaldo, y se prueba restaurándolo.** `npm run db:backup` genera un dump
verificado con retención; `npm run db:restore <archivo>` restaura en una base
*scratch* y cuenta filas por tabla. Un respaldo nunca restaurado es una hipótesis.
El WAL archiving sigue apagado: el RPO de hoy es el intervalo entre respaldos.

## Despliegue: lo que una revisión de infraestructura dejó fijado

**Las migraciones se aplican con un servicio, no a mano.** La imagen de runtime
solo contiene `dist/apps/<app>/main.js`: no lleva las migraciones ni `ts-node`, así
que no puede aplicarlas. Hay un target `migrator` aparte en el Dockerfile (copia
`libs/` y usa `ts-node`) y un servicio `migrator` en compose con `restart: "no"`.
Los tres servicios con base dependen de él por
`condition: service_completed_successfully`.

Sin esto, un `compose up` sobre un volumen nuevo levantaba cinco contenedores
"healthy" contra una base vacía, y el fallo aparecía en la primera consulta de un
usuario. Verificado: en frío, el migrador crea las 6 tablas y 26 índices antes de
que arranque cualquier servicio.

**Todo comando de compose lleva `--env-file .env`.** Compose resuelve su
directorio de proyecto en `docker/` y busca `docker/.env`, que no existe;
`env_file` alimenta el entorno del contenedor pero **no la interpolación del
YAML**. Sin el flag, `npm run db:up` falla con `DB_PASSWORD is missing a value` —
y encadenado en un pipe el error se perdía con exit 0. Usá los scripts
(`db:up`, `docker:up`, `docker:migrate`), no `docker compose` a mano.

**Cada servicio recibe solo los secretos que usa.** El compose no usa un
`env_file` compartido: declara `environment:` explícito por servicio. Así el
gateway es el único con `JWT_SECRET`, y el gateway y el BFF no reciben
`DB_PASSWORD`. Verificable con `docker exec <contenedor> env`.

Corolario del esquema de configuración: **el esquema Joi valida formato, no
presencia** de lo que solo usan algunos servicios. `JWT_SECRET`, `DB_*` y
`CORS_ORIGINS` están como `optional()` y quien los consume los exige con
`getOrThrow`. Si los hicieras `required()`, habría que darle a los microservicios
el secreto de firma que por topología no deben conocer, solo para que arranquen.

**Tres redes, no una.** `edge` (solo el gateway), `app` (gateway + BFF +
servicios) y `data` (Postgres + los tres que persisten), las dos últimas con
`internal: true`. El gateway **no** está en `data`: la regla "el gateway no accede
a la base" la sostiene la red, no solo el código. Verificado: desde el gateway,
`postgres` da `ENOTFOUND`.

**`allowUnknown` se queda en `true`, y no es negociable.** `@nestjs/config` valida
`process.env` completo: con `false`, rechaza `PATH`, `HOME` y todas las `npm_*`, y
el proceso no arranca (comprobado en un contenedor). Para atajar el error que
`allowUnknown` deja pasar —`CORS_ORIGIN` en vez de `CORS_ORIGINS`— existe
`libs/common/src/config/validate-env.ts`: rechaza cualquier variable con un
prefijo del proyecto que el esquema no declare. Si agregás una variable nueva,
declarala ahí o el arranque falla con el nombre exacto.

**Los healthchecks son de los cinco procesos, no solo del gateway.** Los cuatro
internos usan un chequeo TCP contra su propio puerto. `restart: unless-stopped`
solo reacciona a que el proceso muera: un proceso colgado (pool agotado, event
loop bloqueado) seguía "Up" indefinidamente sin que nadie lo detectara.

**`/health/ready` existe porque `/health/live` no alcanza para un balanceador.**
Liveness devuelve 200 con todos los circuitos abiertos; readiness devuelve 503 si
alguno está OPEN, sin revelar topología (es público). El healthcheck del gateway
consulta `ready`, no `live`.

**El logging tiene techo y filtra los healthchecks.** El filtro comparaba
`req.url === '/health/live'` y con el prefijo global la URL real es
`/api/v1/health/live`: nunca aplicaba, y cada chequeo logueaba el request completo
con todos los headers de helmet — del orden de 14 MB/día de ruido por instancia,
sin rotación, en el mismo disco que el volumen de Postgres y los respaldos. Ahora
compara por inclusión y el compose fija `max-size: 10m, max-file: 3`.

**`LOG_LEVEL` y `ENABLE_SWAGGER` los fija el compose, no el `.env`.** El `.env` de
desarrollo tiene `debug` y `true`; un contenedor con `NODE_ENV=production`
heredándolos es cómo terminás logueando payloads en producción. El esquema además
prohíbe `ENABLE_SWAGGER=true` con `NODE_ENV=production`.

## La heurística de urgencia: por qué tiene tres listas y no una

`TicketFactory` eleva la prioridad cuando el texto sugiere que algo está caído,
porque los usuarios rara vez marcan CRITICAL aunque su servicio no funcione. La
primera versión era una lista plana con match por subcadena, y fallaba en los dos
sentidos — ambos detectados probando contra la API:

- **Falso negativo, el peor:** la lista tenía `'caído'` con tilde y `'caida'`, así
  que *"El servidor de correo esta caido"* **no escalaba**. El caso más típico de
  urgencia real pasaba desapercibido por un acento que nadie escribe cuando está
  apurado. Ahora el texto se normaliza (`normalize('NFD')` + quitar diacríticos) y
  las señales se escriben sin tildes.
- **Falsos positivos:** `'producción'` y `'urgente'` escalaban solas, así que
  *"Consulta sobre el ambiente de producción"* y *"la documentación del
  procedimiento urgente"* subían de prioridad. Y `'no funciona'` matcheaba dentro
  de *"ya no funciona mal, quedó resuelto"*.

Las tres listas responden a eso:

| Lista | Qué contiene | Efecto |
|---|---|---|
| `STRONG_SIGNALS` | describe un servicio caído (`no funciona`, `esta caido`, `nadie puede`) | escala sola |
| `CONTEXT_SIGNALS` | agrava pero no describe falla (`produccion`, `urgente`, `bloqueado`) | escala solo con una fuerte, o dos de contexto juntas |
| `DAMPENING_SIGNALS` | el usuario dice que no corre prisa (`consulta`, `ya funciona`, `sin apuro`) | **anula** el escalamiento |

Si agregás una señal, decidí en qué lista va: una palabra ambigua en
`STRONG_SIGNALS` genera falsos positivos que el usuario percibe como que el
sistema "se inventa" urgencias. Los casos están fijados en
`ticket.factory.spec.ts`.

## QA: los invariantes que una revisión funcional dejó fijados

Una pasada de QA encontró 18 hallazgos, de los cuales **9 solo aparecían
atravesando los cinco procesos** — la suite unitaria estaba en 99/99 verde. De ahí
salieron estas reglas.

**Las reglas de permisos viven en UN solo lugar:
`libs/common/src/contracts/ticket-permissions.ts`.** Antes estaban escritas dos
veces con lógica distinta: el caso de uso autorizaba una cosa y
`TicketDetailComposer` le informaba otra al frontend. El resultado medible era que
la UI le escondía al solicitante el botón de cerrar su propio ticket (que sí podía)
y le ofrecía al agente no asignado acciones que devolvían 403. El BFF y los casos
de uso importan las **mismas funciones**; si agregás una regla, va ahí.

**Los permisos del solicitante dependen del estado de origen, no de una lista
plana** (`REQUESTER_TRANSITIONS`). La misma transición significa cosas distintas
según de dónde venga: `IN_PROGRESS` desde `ASSIGNED` es una afirmación del equipo,
desde `RESOLVED` es reabrir y desde `WAITING_CUSTOMER` es responder. Con una lista
plana el solicitante quedaba **sin ninguna acción disponible** en
`WAITING_CUSTOMER`: cerrar daba 409 por la máquina de estados y las transiciones
legales daban 403 por el rol. La autorización calcula la **intersección** de las dos
tablas, y por eso el caso de uso devuelve 409 con la lista de estados alcanzables en
lugar de un 403 opaco.

**Un booleano de query string no se convierte con `@Type(() => Boolean)`.**
`Boolean('false') === true`, así que `unassignedOnly=false` filtraba idéntico a
`=true` — resultados incorrectos sin ningún síntoma. Usá el `@Transform` de
`toOptionalBoolean`, que devuelve `undefined` para lo no reconocible en vez de
inventar un `false`.

**Un filtro que no se puede aplicar se rechaza, nunca se descarta.**
`createdFrom` sin `createdTo` se ignoraba en silencio: pedir
`createdFrom=2099-01-01` devolvía la tabla entera en lugar de nada. Ahora el rango
es abierto por cualquiera de los dos extremos.

**Quien recibe una notificación es el interesado, no quien hizo la acción.** Se
notificaba a `changedById` y a `authorId`, así que el agente recibía un aviso por
cada cambio que él mismo hacía y el solicitante no se enteraba nunca de que su
ticket avanzó. Los eventos `ticket.status-changed` y `ticket.commented` llevan
`requesterId` y `assigneeId` justamente para que el consumidor pueda decidir.

**La asignación es idempotente.** Asignar a quien ya está asignado es un no-op: sin
eso, cinco clics en "asignar" generaban cinco avisos al mismo agente. Ojo con el
razonamiento equivocado acá: el índice único de notificaciones **no** protege,
porque cada evento trae un `eventId` nuevo — cubre la reentrega del transporte, no
la repetición de la operación.

**Un booleano de query string tampoco se convierte con `enableImplicitConversion`.**
El `ValidationPipe` corre **sin** esa opción: con ella, class-transformer aplicaba la
semántica de `Boolean(string)` y pisaba los `@Transform` de los DTOs, así que el
arreglo del campo no alcanzaba. Cada DTO declara su conversión explícitamente
(`@Type(() => Number)` para numéricos, `@Transform` para booleanos) — se lee en el
campo, no en una opción global. Hay tests del DTO con las mismas opciones que usa el
pipe, justamente porque el bug estaba en esa combinación y no en el campo.

**Un timeout es un fallo de transporte, y en Docker es el que ves primero.** Con un
contenedor detenido, el `ClientProxy` reintenta la resolución DNS (`EAI_AGAIN`) y el
`timeout()` de RxJS dispara **antes** de que aparezca el código de red. Por eso
`isTransportFailure` reconoce `TimeoutError`/`EmptyError` por nombre además de los
códigos: sin eso, el login devolvía 503 (ahí el error sí era `ENOTFOUND`) pero crear
un ticket devolvía 500 — el mismo bug, dos caminos distintos.

**Un 503 `UPSTREAM_UNAVAILABLE` NO cuenta contra el circuito de quien lo devuelve.**
Es la última pieza del fallo en cascada: `tickets-service` está sano cuando reporta
que `users-service` se cayó; contarlo abría también su circuito y cortaba las
operaciones de tickets que no necesitan users (buscar, comentar, cambiar estado).
Amplificaba la caída en lugar de contenerla.

**`isTransportFailure` debe incluir `ENOTFOUND`.** Es el código que ocurre de verdad
cuando un contenedor está detenido: no rechaza la conexión, no resuelve por DNS. Con
solo `ECONNREFUSED/ECONNRESET/ETIMEDOUT`, una caída real devolvía 500 en lugar de
503 — y el 500 espurio contaba como fallo de infraestructura, así que una caída de
`users-service` empujaba hacia OPEN el circuito de `tickets-service`, que estaba
sano. El mismo modo de falla en cascada que ya se había corregido, entrando por otra
puerta.

**Los comodines de `ILIKE` se escapan.** Buscar `%` devolvía la tabla entera. No es
inyección (el valor va parametrizado) pero es un resultado incorrecto.

**`get<boolean>`, no `get<string>`, para leer flags booleanos del ConfigService.** El
esquema los declara con `Joi.boolean()`, así que ConfigService devuelve un booleano y
comparar contra el string `'false'` era siempre falso: `SCHEDULER_ENABLED=false` no
desactivaba nada, y la mitigación documentada para replicar servicios era un no-op.

**Los errores de validación dicen qué campo está mal.** `disableErrorMessages` en
producción suprimía todo el detalle y cualquier entrada malformada respondía
`"Bad Request"` sin nada más. El `exceptionFactory` devuelve la lista de campos
inválidos con su motivo — información que el cliente mismo envió — y nada del
interior.

### Sobre los tests: cuatro que estaban verdes sin probar nada

Vale como advertencia de qué evitar al escribir los próximos:

- `transport-failure.spec.ts` afirmaba exactamente los tres códigos que la
  implementación manejaba, y no el que ocurre en producción. **Un test escrito contra
  la implementación en lugar de contra el requisito siempre pasa.**
- `notification.factory.spec.ts` contaba las notificaciones (`toHaveLength(1)`) y
  nunca verificaba **a quién** se le avisaba — que era justo lo que estaba mal.
- `ticket.specifications.spec.ts` decía en su cabecera que `applyTo` se cubría "en
  los tests de integración del repositorio". Esos tests no existían: la mitad que
  corre en producción seguía sin cubrir. Cerrado — ver `npm run test:integration`
  más abajo.
- El assert `getHours() <= 18` del SLA aceptaba las 18:45 y pasaba con casi cualquier
  hora del día. Ahora se afirma en minutos. (Las 18:00 exactas **sí** son válidas:
  son el cierre de la jornada, y ocurren cuando el SLA consume jornadas completas.)

### `npm run test:e2e` (cerrado)

Existe `test/jest-e2e.json` y 24 tests que cubren los tres escenarios que más valor
tenían: (1) ciclo de vida completo con los cuatro actores verificando **el
destinatario** de cada notificación; (2) que un 4xx repetido no abra ningún circuito;
(3) concurrencia e idempotencia sobre el mismo ticket. Los tres cubren cosas que
ningún test unitario puede ver. Corre contra el stack de desarrollo real (o, en CI,
contra el que el propio job `e2e` levanta con `docker compose`) — ver la sección de
CI/CD.

### Un tercer nivel: Specifications y repositorio contra Postgres real

`npm test` solo verifica `isSatisfiedBy` (en memoria). La traducción a SQL de cada
Specification (`applyTo`) y las consultas agregadas de `TicketsRepository`
(`averageResolutionMinutes`, `findOverdueUnmarked`, `countByStatus`) no tenían
ninguna cobertura contra un motor real — incluido si los índices GIN/parciales/
funcionales que este esquema usa (ver la sección de base de datos) realmente se
usan, verificado con `EXPLAIN` y `enable_seqscan=off` igual que se hace a mano.

`npm run test:integration` (`test/integration/`, config en `test/jest-integration.json`)
cubre eso, sin levantar los 6 procesos — eso ya lo hace `test:e2e`. Requiere:

1. Una base dedicada, migrada: `DB_NAME=ticketera_integration npm run migration:run`
   (o cualquier valor de `DB_NAME` que contenga `test` o `integration` — el
   data-source de estos tests se niega a arrancar si no, porque `resetDatabase()`
   trunca las tablas de dominio completas entre cada test).
2. Correr con las mismas variables: `DB_NAME=ticketera_integration npm run test:integration`.

En CI corre como el job `integration`, con su propio Postgres efímero — ver
`.github/workflows/ci.yml`.

## Mantenibilidad: lo que dejó una pasada de limpieza (2026-09)

Una revisión de mantenibilidad tocó 22 archivos sin cambiar comportamiento externo
(salvo dos correcciones puntuales marcadas abajo). Queda documentado para no
malinterpretar el porqué si alguien lo lee en el diff más adelante.

**El breaker de `'users-service'` ahora se registra con `timeoutMs` explícito
también en `AuthService.login`.** `CircuitBreakerRegistry` es un mapa por
`name`: el primer `get()` que llega en el proceso fija la configuración y los
siguientes la heredan en silencio. `UpstreamClient` ya pedía `'users-service'`
con `timeoutMs: 8_000`; `login` pedía el mismo nombre sin overrides, así que
según el orden de arranque el timeout real del login podía terminar siendo el
default en lugar de 8 s. `CircuitBreakerRegistry.get` ahora lanza si dos
llamantes piden el mismo `name` con overrides distintos
(`assertConsistentOverrides`), para que el conflicto aparezca en el arranque y
no como un timeout que varía según quién se registró primero.

**`AllRpcExceptionsFilter.serialize` se partió en un método por tipo de
excepción** (`fromDomainError`, `fromHttpException`, `fromRpcException`,
`fromUnknown`) sin cambiar la lógica de mapeo: era un único método con cuatro
ramas condicionales largas, y la regla de "repropagar intacto un error ya
serializado" (ver la sección de seguridad) quedaba enterrada en el medio.

**`HandleDomainEventUseCase.resolveEmails` resuelve todos los destinatarios de
un lote en una sola llamada RPC**, en vez de una por notificación. Antes, un
evento con solicitante y agente asignado pedía el email del mismo usuario dos
veces; con varios destinatarios eran N llamadas a `users-service` por evento.
Requirió agregar `USERS_PATTERNS.findMany` con soporte de filtro por `ids`
(`UserByIdsSpec`, nueva specification) del lado de `users-service`. El
fallback ante un `users-service` caído sigue siendo el mismo: todo el lote se
degrada a canal in-app.

**Corrección real (no solo estilo): `NotificationFactory.forSlaBreached`
tipaba `assigneeId` como `unknown` y lo pasaba por `String(assigneeId)`.**
Con `assigneeId` ya `null` (el caso que la línea de arriba existe para
filtrar), `String(null)` produce el string `"null"` en vez de que TypeScript
detecte el problema en compilación. Ahora el payload se tipa como
`Record<string, string | null>` y `recipientId` recibe el valor tal cual, sin
la conversión que enmascaraba el `null`.

**`DomainEventPublisher.publish` documenta explícitamente por qué no espera a
los observadores.** El código ya era fire-and-forget (`emitAsync` sin
`await` del resultado agregado), pero no había ninguna nota de que
`emitAsync` de `eventemitter2` arma un `Promise.all` de lo que devuelven los
listeners independientemente de sus opciones — así que await'earlo bloquearía
la respuesta HTTP con la latencia de cada observador (el RPC a
`notifications-service`, por ejemplo), justo lo que la regla de `emit()`
fire-and-forget de la sección de arquitectura busca evitar. Quedó como
comentario de clase para que nadie "corrija" esto agregando el `await` que
falta.

**`EmailBodyCleaner` reemplazó el regex `/^-{2,}.*-{2,}$/` por una
comparación de string** (`isDashSeparatorLine`): ese patrón es vulnerable a
backtracking super-lineal sobre líneas largas de guiones repetidos (ReDoS),
y el caso que cubre es simplemente "empieza y termina con `--`".

**`AddCommentUseCase.assertCanComment` recibía `TicketStatus.OPEN` hardcodeado
en vez del estado real del ticket.** `canComment` consulta el estado como
parte de la decisión de autorización (igual que `canChange`), así que
comentar un ticket que no estaba `OPEN` evaluaba la regla contra un estado
que no era el suyo. Ahora recibe `ticket.status`. Es el mismo tipo de bug que
motivó separar `assertCanChange`/`assertCanComment` de una lista plana en la
sección de QA: la autorización que depende del dato tiene que mirar el dato
real, no un valor de conveniencia.

**Cambios de estilo sin efecto de comportamiento**, agrupados porque son el
mismo tipo de limpieza repetida: `replace(/\r\n/g, ...)` → `replaceAll`,
`new Date(from.getTime())` → `new Date(from)`, imports duplicados del mismo
módulo consolidados en una línea, un `if/else if` anidado en
`GetUserUseCase.findUser` extraído a método, y los backslashes de regex
(`\\Seen`, `\\$1`) escritos con `String.raw` para que se lean como el literal
que son. Ninguno cambia el comportamiento; se listan para que un futuro diff
grande no se lea como sospechoso.

**Se agregó integración de SonarQube MCP** (`.mcp.json`,
`sonar-project.properties`, `.github/instructions/sonarqube_mcp.instructions.md`)
para poder correr este tipo de revisión de mantenibilidad con análisis estático
además de lectura manual.

## Trazabilidad: el correlation-id llega hasta el microservicio (2026-09)

`CorrelationIdMiddleware` siempre asignó un `x-correlation-id` en el borde HTTP
del gateway y lo logueó ahí — pero moría en el borde. `UpstreamClient.send()`
(y cualquier otro llamante de `withRpcAuth`) armaba el mensaje RPC sin
adjuntarlo, así que cruzado el transporte interno, el log de `bff-web`,
`tickets-service`, `users-service` o `notifications-service` no tenía forma de
correlacionarse con el request HTTP que lo originó. Con seis procesos, eso
significaba reconstruir a mano por timestamp aproximado cuál línea de qué
proceso correspondía a qué request — exactamente lo que el propio middleware
decía evitar, y solo lo evitaba para el primer salto.

**Cómo se propaga ahora, sin que ningún caller lo pase a mano:**

- `RequestContext` (`libs/common/src/context/request-context.ts`) — un
  `AsyncLocalStorage` que guarda el correlation-id activo durante el ciclo de
  vida de un request, HTTP o RPC.
- `CorrelationIdMiddleware` abre ese contexto además de setear el header.
- `withRpcAuth` lo lee del contexto y lo adjunta al payload saliente junto al
  secreto compartido — automático en los ocho call sites que ya existían
  (`UpstreamClient`, `ServiceClients` del BFF, `AuthService.login`, los
  clientes de `tickets-service` hacia `users-service`, el forwarder de eventos
  de integración, `email-ingestion` y `notifications-service`), sin tocar
  ninguno.
- `RpcCorrelationInterceptor` (`libs/common/src/interceptors/
  rpc-correlation.interceptor.ts`), global en los cinco microservicios (junto
  a `RpcAuthGuard` en cada `main.ts`) — extrae el correlation-id del mensaje
  entrante, lo limpia del payload igual que `RpcAuthGuard` hace con el
  secreto, y reabre el contexto para el resto del handler. Si ese handler
  llama a su vez a otro servicio (`tickets-service` → `users-service`, por
  ejemplo), lo hereda también sin código nuevo.
- `AllRpcExceptionsFilter` suma `correlationId` a `SerializedRpcError` y a
  cada línea de log de error — mismo campo que ya usaba
  `http-exception.filter.ts` del lado del gateway.

**Si no hay ningún `RequestContext` activo** (un job del scheduler, el poller
de `email-ingestion`), `withRpcAuth` genera uno nuevo en el momento: esa cadena
queda igual de trazable entre los servicios que toque, aunque no venga de un
request HTTP.

**Agregar un cliente RPC nuevo no requiere nada especial**: mientras pase por
`withRpcAuth`, el correlation-id viaja solo. Lo que sí hay que hacer es
registrar `RpcCorrelationInterceptor` como interceptor global en el `main.ts`
de cualquier microservicio nuevo, igual que ya se hace con `RpcAuthGuard` —
sin él, ese servicio sigue recibiendo el campo pero nunca lo lee, y sus propias
llamadas salientes generan un correlation-id nuevo en cada una en lugar de
heredar el de la cadena.

Verificado contra el stack real, sin datos simulados: un 403 disparado a
través del gateway (agente sin relación intentando cambiar el estado de un
ticket ajeno) devuelve `x-correlation-id` en la respuesta HTTP, y ese mismo id
aparece en el log de `tickets-service` — el proceso que evaluó el permiso y lo
rechazó, tres saltos de red después del navegador.

## Ingesta de tickets por correo

`email-ingestion-service` (TCP 4104) convierte correos en tickets. Es un servicio
aparte y no un módulo de `tickets-service` a propósito: aísla una dependencia externa
y frágil —el servidor de correo— y tiene su propio poller, así que un buzón que no
responde no arrastra al resto.

**El buzón es `soporte@cmm.uchile.cl`, dedicado, y no `sistemas@`.** La razón es
concreta: `sistemas@` recibe la salida de los crontab de los servicios. Cada uno
convertido en ticket es basura que alguien limpia a mano, y una bandeja con ruido hace
que el equipo deje de confiar en la herramienta antes de que empiece a servir. Con un
buzón nuevo además se puede arrancar en cero, que en un buzón con historia no tiene
forma limpia de definirse.

**Por eso el filtro anti-ruido no es opcional aunque el buzón arranque limpio**: es
justamente lo que hace viable reenviar después `sistemas@ → soporte@` sin que ese ruido
vuelva. `EmailClassifier` descarta por tres vías, en este orden:

1. **Bucle** — el correo viene del propio buzón. Se corta antes que cualquier otra
   regla: notificar desde la dirección que se lee es cómo se genera un bucle infinito.
2. **Máquina** — cabeceras estandarizadas (`Auto-Submitted` de RFC 3834, `Precedence`,
   `List-Id`), remitentes (`root@`, `cron@`, `nagios@`, `backup@`) y asuntos típicos
   (`Cron <...>`, `Backup completed`, `Delivery Status Notification`).
3. **Dominio** — solo `MAIL_ALLOWED_DOMAINS`.

Falla hacia el **descarte** cuando duda de que el remitente sea una persona, y hacia el
**ticket** cuando duda del contenido: perder un pedido legítimo es peor que crear un
ticket de más, pero un remitente automático nunca es un pedido legítimo.

**Una respuesta se detecta ANTES de decidir crear.** El código viaja en el asunto
(`[TCK-000123]`) y se prioriza sobre `In-Reply-To`, porque el asunto sobrevive cuando
alguien reenvía a mano o responde desde un cliente que pierde las cabeceras de
threading. Una respuesta convertida en ticket nuevo parte la conversación en dos y es
el error más visible de una ingesta.

**El remitente desconocido se da de alta automáticamente** como `REQUESTER`, con
contraseña aleatoria que nadie conoce, y solo si su dominio está autorizado. Quien
escribe por primera vez es justamente el que más necesita que su pedido entre; sin el
límite de dominio, cualquier remitente del mundo podría crear usuarios mandando un
correo.

**El correo se marca como leído recién cuando la ingesta terminó bien.** Si el proceso
muere entre leer y crear el ticket, el correo sigue pendiente y se reprocesa: es más
seguro reprocesar que perder un pedido, y la idempotencia por `Message-ID` evita el
duplicado. Con un matiz que ya costó un bug: **`ProcessedEmailRepository.exists()`
ignora los `FAILED`**. Si los contara, el reintento se descartaría por "ya procesado" y
el correo quedaría perdido en silencio.

### Probar sin el buzón creado

`MAIL_ADAPTER=simulado` lee archivos `.eml` de `MAIL_SIMULATED_DIR`. Existe porque el
buzón institucional tarda un trámite y esperarlo para empezar a probar sería tiempo
perdido: con esto se ejercita el camino completo —parseo, clasificación, limpieza, alta
de usuario, creación, threading— con correos reales guardados como archivo. Después del
trámite sigue sirviendo para reproducir un caso raro sin reenviarse correos a uno mismo.

Hay ejemplos de los cuatro caminos en `apps/email-ingestion-service/fixtures/`.

Para el buzón real, `MAIL_ADAPTER=imap` contra `imap.gmail.com:993`. Google Workspace
exige **contraseña de aplicación** de 16 caracteres (la contraseña de la cuenta no
funciona para IMAP desde 2022), con verificación en dos pasos activa e IMAP habilitado.
La alternativa institucional es la API de Gmail con cuenta de servicio y delegación de
dominio: evita tener una contraseña en el entorno, pero necesita que TI la autorice.
Cuando esté, se suma otro adaptador con la misma interfaz y no cambia nada más.

### Dos trampas de tildes, el mismo error dos veces

El limpiador de cuerpo tenía el patrón `/escribió:/` y una respuesta real que decía
"escribio" dejaba el encabezado de la cita dentro del comentario del ticket. Es
**exactamente** el mismo tipo de falla que tuvo la heurística de urgencia con `'caído'`.
Si escribís un patrón sobre texto que tipea una persona, contemplá la forma sin tilde —
acá con una clase de caracteres (`escribi[oó]`) y no normalizando, porque quitar
diacríticos cambia la longitud y los índices dejan de servir para cortar el original.

## Alta de usuarios: dos vías, y por qué hacen falta las dos

**Por la API** — `POST /api/v1/users`, con `@Roles(ADMIN)`. Es la vía normal: un
administrador crea técnicos, supervisores y otros administradores. El `role`, los
`skills` y `maxConcurrentTickets` van en el cuerpo, y los dos últimos alimentan la
estrategia de asignación (`SkillBasedAssignmentStrategy` mira `skills`;
`LeastLoadedAssignmentStrategy` respeta la capacidad).

**Por consola** — `npm run user:create`. No es una comodidad: resuelve un bloqueo
circular real. Crear un usuario por la API exige un ADMIN autenticado, y el seed se
niega a correr con `NODE_ENV=production`. En una base limpia de producción **no había
ninguna forma** de crear el primer administrador.

El comando reusa `CreateUserUseCase`, así que aplica exactamente las mismas reglas que
la API — política de contraseñas, hashing, normalización del email, unicidad, capacidad
por omisión según el rol. Duplicar esa lógica en un script sería la manera de que las
dos vías se desincronicen.

**La contraseña no se pasa por argumento**, y es deliberado: quedaría en el historial
del shell y visible en `ps` para cualquier usuario de la máquina. Por omisión se genera
una y se imprime **una sola vez**; con `--password-stdin` se lee de la entrada estándar,
que es la vía para automatizar sin dejar rastro.

En el despliegue Docker se corre con el target de herramientas, que es el mismo del
migrador (copia `apps` además de `libs` justamente para esto):

```bash
docker compose --env-file .env -f docker/docker-compose.yml run --rm migrator \
  npm run user:create -- --email=admin@cmm.uchile.cl --name="Nombre" --role=ADMIN
```

**La tercera vía crea solo solicitantes.** La ingesta de correo da de alta al remitente
desconocido como `REQUESTER` y nunca con más permisos: el rol no puede depender de algo
que el remitente controla.

## Diseño de interfaz: mockups pendientes de aprobación

Este backend no tiene frontend propio en el repositorio, pero hay mockups de
referencia (login, listado de tickets, detalle de ticket y reportes — versión
web y mobile de cada uno) construidos como Design Component en un artifact
externo, con el rojo Pantone 186C como color de marca. Sirven de guía visual
para cuando se implemente el cliente.

**La vista del solicitante (rol `REQUESTER`) queda deliberadamente sin
diseñar, pendiente de aprobación de los stakeholders.** Los mockups actuales
son todos de la vista de agente/supervisor (sidebar con Tickets, Mis tickets,
Reportes, Usuarios — ninguna de las cuales corresponde a lo que un
`REQUESTER` puede ver según el modelo de permisos de `libs/common/src/
contracts/ticket-permissions.ts`). Antes de diseñarla hay que resolver con
el stakeholder qué debe mostrar: solo los tickets propios, sin acceso a
`Reportes` ni `Usuarios`, y con las acciones que `REQUESTER_TRANSITIONS`
efectivamente le permite en cada estado (ver la sección de QA más arriba
sobre por qué esa tabla depende del estado de origen). No agregar esta
pantalla al artifact hasta tener esa aprobación.

## Decisiones tomadas y sus costos

Están acá para que no se re-litiguen en cada cambio, y para que se sepa qué duele.

1. **Una sola base de datos Postgres, no una por servicio.** Cada servicio es
   dueño exclusivo de las escrituras de sus tablas (`users` → users-service,
   `tickets`/`ticket_comments`/`ticket_status_history` → tickets-service,
   `notifications` → notifications-service). *Costo:* es un monolito distribuido
   en la capa de datos; no se puede escalar ni migrar la base de un servicio de
   forma independiente. Si eso se vuelve necesario, el primer corte natural es
   `notifications`.

2. **Modelo único: la entidad TypeORM es también el agregado de dominio.**
   `Ticket` tiene decoradores de TypeORM y reglas de negocio en la misma clase.
   *Costo:* el dominio conoce el ORM. *Beneficio:* no hay entidad de dominio +
   entidad de persistencia + mapper que se desincronizan. No introduzcas mappers
   sin una razón concreta.

3. **Transporte TCP, sin broker.** Simple de correr en local y sin infraestructura
   extra. *Costo:* los eventos de integración **no son durables** — si
   `notifications-service` está caído cuando se emite un evento, esa notificación
   se pierde (queda registrada en el log del forwarder). El siguiente paso, si
   esto importa, es una **tabla outbox** en tickets-service, no cambiar de broker.

4. **El agregado nunca reasigna una colección `OneToMany`.** `addComment` y
   `applyStatus` **no** hacen `this.comments = [...]`. TypeORM interpreta la
   reasignación como "estas son todas las filas" y pone en `NULL` la FK de las
   que falten — lo que viola el `NOT NULL` y borra el historial. Los asientos
   nuevos se acumulan en `pendingStatusHistory` y los inserta
   `TicketsRepository.saveWithManager`. **Este es un bug ya vivido: no lo revivas.**

5. **JWT sin revocación.** El access token (15 min) es la fuente de verdad
   mientras vive; no se consulta la base en cada request. *Costo:* desactivar un
   usuario no invalida su token hasta que expire, y el refresh token (7 d) usa el
   mismo secreto y no es revocable. Si hace falta revocar, hay que agregar una
   tabla de refresh tokens y un secreto separado.

6. **El envío real de emails no está implementado.** `EmailChannelStrategy`
   registra en el log en lugar de salir a un SMTP. Conectarlo es reemplazar el
   cuerpo de `execute` — la interfaz ya está donde tiene que estar.

7. **El scheduler de SLA asume una sola instancia.** `SlaMonitorScheduler` se
   protege del solapamiento con un flag en memoria. Con réplicas, dos procesos
   barrerían en paralelo: haría falta un lock distribuido (`pg_advisory_lock`
   alcanza). El barrido procesa 200 tickets por corrida (`BATCH_SIZE`) y devuelve
   `truncated: true` si quedaron más; a los 5 minutos sigue con el resto.

8. **`RPC_SHARED_SECRET` es un secreto único y estático.** Autentica al llamador
   pero no lo identifica: cualquier servicio con el secreto puede invocar
   cualquier mensaje de cualquier otro. Para granularidad por servicio harían
   falta credenciales por par o mTLS. *Costo asumido:* un servicio comprometido
   puede hablarle a los demás; lo que impide es el acceso desde fuera del grupo.

9. **No hay WAL archiving.** El RPO efectivo es el intervalo entre respaldos, no
   minutos. Activar `archive_mode=on` es el siguiente paso si el dato importa.

10. **Replicar los servicios internos no reparte carga.** El `ClientProxy` de Nest
    resuelve `host:port` una vez y mantiene un socket persistente: con tres
    réplicas de `users-service`, todo el tráfico queda clavado en una. Escalar
    horizontalmente exige un balanceador TCP delante de cada servicio. *Hasta
    entonces:* escala vertical, y `SCHEDULER_ENABLED=false` en las réplicas extra.

11. **`THROTTLE_LIMIT` es por instancia.** El store del throttler es en memoria, así
    que dos gateways duplican el límite real. Con más de una réplica hay que
    dividir el valor, o mover el store a una caché compartida.

12. **Los respaldos siguen en el mismo disco que la base.** `backup.sh` verifica el
    dump, registra su checksum y aplica retención, pero no hay job que lo corra ni
    copia fuera del host. El fallo que importa —se muere el disco— se lleva la base
    y sus respaldos juntos. El script marca dónde agregar el envío remoto.

## Comandos

```bash
# Base de datos
npm run db:up                 # levanta Postgres en docker
npm run migration:run         # aplica migraciones
npm run migration:show        # qué migraciones están aplicadas
npm run seed                  # usuarios de prueba (nunca en producción)
npm run db:backup             # dump verificado con retención
npm run db:restore <archivo>  # restaura en una base scratch y cuenta filas

# NO existe `migration:generate` a propósito: su diff borra los índices
# GIN/parciales/funcionales de este esquema. Las migraciones se escriben a mano.

# Desarrollo: los cinco procesos con watch
npm run start:dev
# o uno solo: npm run start:gateway | start:bff | start:users | start:tickets | start:notifications

# Verificación
npm run build                 # compila los cinco (webpack, un main.js por app)
npm test                      # suite completa (mocks, sin base)
npm run test:integration      # Specifications + repositorio contra Postgres real
npm run test:e2e              # los 6 procesos reales, atravesados por HTTP
npm run lint

# Producción / stack completo en Docker
npm run docker:up             # build + up de los 6 contenedores
npm run docker:migrate        # aplica migraciones con el servicio migrador
npm run docker:logs           # sigue los logs de los 6
npm run docker:down
```

Todos los scripts de compose pasan `--env-file .env`: sin eso la interpolación del
YAML no encuentra `DB_PASSWORD` y falla.

Swagger en `http://localhost:3000/api/docs`, solo con `ENABLE_SWAGGER=true`.
Estado de los circuitos en `GET /api/v1/health` (requiere SUPERVISOR o ADMIN);
liveness público en `GET /api/v1/health/live`.

Usuarios del seed (contraseña `Ticketera2026`):
`admin@`, `supervisor@`, `agente.redes@`, `agente.software@`, `usuario@` +
`ticketera.local`.

## Convenciones de código

- **Todo el código, comentarios y mensajes de error en español.** Los
  identificadores técnicos y los nombres de patrones quedan en su forma original
  (`Repository`, `execute`, `findPaged`).
- Errores: el dominio lanza `DomainError` (`libs/common/src/filters/domain.errors.ts`),
  **nunca `HttpException`**. El mapeo a status HTTP es responsabilidad de los
  filtros del borde. Si necesitás un código nuevo, agregá una subclase ahí.
- Un caso de uso = una clase que extiende `ApplicationService` con un solo
  `execute`. Si un servicio junta varios métodos de negocio, dividilo.
- Los controladores (HTTP y RPC) son adaptadores delgados: validan, resuelven la
  identidad y despachan. Un `if` de negocio en un controlador está mal ubicado.
- La identidad **siempre** sale del token (`@CurrentUser()`), nunca del body.
  Mismo criterio para `requesterId`, `authorId` y `changedById`.
- `orderBy` que viene del cliente pasa por la whitelist `sortableColumns` del
  repositorio. Interpolarlo directo en `ORDER BY` es inyección SQL.
- Todo cliente RPC adjunta el secreto con `withRpcAuth(payload, secret)`. Un
  `send`/`emit` sin él es rechazado por el destinatario.
- Toda función de autorización enumera los casos permitidos y **lanza al final**.
  Nunca dejes una rama que caiga sin decidir.
- Los nombres de mensaje RPC viven solo en `libs/common/src/contracts/message-patterns.ts`.
  Nunca escribas el string suelto: un rename debe romper en compilación.
- Eventos de dominio: nombre en pasado (`ticket.created`), payload serializable,
  inmutables.
- `DB_SYNCHRONIZE` jamás en producción. Todo cambio de esquema es una migración
  escrita a mano en `libs/database/src/migrations/`.

## Agregar una funcionalidad: el recorrido típico

Ejemplo, "permitir adjuntar archivos a un ticket":

1. Migración en `libs/database/src/migrations/` + entidad en `libs/database/src/entities/`.
2. Si hace falta una regla nueva del agregado, va en `Ticket` con su test en
   `ticket.entity.spec.ts`.
3. Evento de dominio en `libs/common/src/events/ticket.events.ts`.
4. Caso de uso en `apps/tickets-service/src/application/use-cases/`, registrado
   en `tickets.module.ts`.
5. Patrón de mensaje en `message-patterns.ts` + handler en `tickets.controller.ts`.
6. DTO validado en `apps/api-gateway/src/dto/` + ruta en
   `apps/api-gateway/src/routes/tickets.controller.ts`.
7. Si la pantalla necesita datos combinados, un composer en `apps/bff-web/src/composers/`.
8. Si el evento debe notificar, un caso nuevo en `NotificationFactory`.
9. Tests: agregado y factory siempre; specifications y estrategias si las
   tocaste; y si agregás una regla de autorización, un caso en
   `authorization.spec.ts` que verifique que el ajeno es rechazado.

## Antes de dar algo por terminado

```bash
npm run build && npm test && npm run lint
```

En CI corren los mismos gates más algunos que localmente no se hacen
(`.github/workflows/ci.yml`): `lint:ci` sin `--fix`, `npm audit --audit-level=high`,
las migraciones contra un Postgres real con `run → revert → run`, `test:integration`
(Specifications y repositorio contra Postgres real), y el build de las seis imágenes
con escaneo de CVEs. El job `e2e` corre al final, atravesando los 6 procesos reales.

Y si el cambio toca el flujo de tickets, probalo de verdad contra la API (`npm run
test:e2e`) además de la suite unitaria.

Si agregaste o tocaste una Specification o una consulta del repositorio, sumale un
caso a `npm run test:integration` — no alcanza con `isSatisfiedBy`, y es más barato
de correr que levantar los 6 procesos con `test:e2e`.

Si tocaste consultas o índices, medí con `EXPLAIN` antes de dar por bueno el
cambio (`npm run test:integration` ya automatiza esto para lo que cubre; para todo
lo demás, a mano):

```bash
docker exec ticketera-postgres psql -U ticketera -d ticketera \
  -c "SET enable_seqscan=off; EXPLAIN <tu consulta>;"
```

Con `enable_seqscan=off`, si el plan sigue siendo `Seq Scan` es porque el índice
**no puede** usarse, no porque el planner prefiera otra cosa.

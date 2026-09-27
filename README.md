# Ticketera — backend de mesa de ayuda

Backend de gestión de tickets de soporte en **NestJS + PostgreSQL**, construido
sobre una arquitectura de microservicios con API Gateway y BFF.

> Para trabajar sobre el código, leé primero [CLAUDE.md](./CLAUDE.md): contiene la
> arquitectura, las convenciones y las decisiones ya tomadas con sus costos.

## Puesta en marcha

```bash
# 1. Configuración
cp .env.example .env
# Editá .env. Obligatorios: DB_PASSWORD, JWT_SECRET y RPC_SHARED_SECRET.
# Generá DOS secretos distintos (uno por variable):
#   openssl rand -base64 48

# 2. Dependencias y base de datos
npm install
npm run db:up
npm run migration:run
npm run seed          # usuarios de prueba

# 3. Los cinco servicios
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Documentación interactiva: `http://localhost:3000/api/docs` (requiere
  `ENABLE_SWAGGER=true`; en producción pide `SWAGGER_USER` / `SWAGGER_PASSWORD`)
- Estado y circuitos: `http://localhost:3000/api/v1/health`

Usuarios del seed (contraseña `Ticketera2026`): `admin@ticketera.local`,
`supervisor@ticketera.local`, `agente.redes@ticketera.local`,
`agente.software@ticketera.local`, `usuario@ticketera.local`.

### Con Docker

```bash
npm run docker:up         # construye y levanta los 6 contenedores
npm run docker:migrate    # aplica migraciones (el servicio migrador ya corre solo en el up)
npm run docker:logs
npm run docker:down
```

El servicio `migrator` aplica las migraciones y los servicios con base esperan a
que termine con éxito, así que un `up` sobre un volumen nuevo deja el esquema
creado antes de atender tráfico.

Los seis contenedores tienen healthcheck, límite de memoria y rotación de logs, y
están repartidos en tres redes (`edge`, `app`, `data`) de forma que el gateway no
alcanza Postgres a nivel de red.

## Procesos

| Servicio | Puerto | Rol |
|---|---|---|
| `api-gateway` | 3000 (HTTP) | Borde: CORS, rate limit, JWT, validación, circuit breaker |
| `bff-web` | 4001 (TCP) | Compone las respuestas por pantalla |
| `users-service` | 4101 (TCP) | Usuarios, roles, verificación de credenciales |
| `tickets-service` | 4102 (TCP) | Dominio de tickets, SLA, asignación |
| `notifications-service` | 4103 (TCP) | Observa eventos y entrega notificaciones |
| `email-ingestion-service` | 4104 (TCP) | Convierte correos entrantes en tickets |

## Qué hace el sistema

- **Clasificación automática.** La prioridad declarada por el usuario es una
  sugerencia: si el texto contiene señales de urgencia ("no funciona",
  "producción", "caído"), se eleva un nivel.
- **SLA por política.** Horario laboral (lun–vie 9–18, saltando fines de semana)
  para el caso general; 24x7 en tiempo corrido para tickets críticos y
  solicitantes VIP. Un barrido cada 5 minutos detecta incumplimientos.
- **Asignación por estrategias.** Escalamiento a supervisor para críticos,
  especialista de la categoría con menos carga, o reparto por carga como
  fallback. Cada decisión queda registrada con su justificación.
- **Máquina de estados explícita.** Las transiciones permitidas están declaradas;
  una transición ilegal devuelve 409 con la lista de las válidas.
- **Notas internas.** Los comentarios internos entre agentes no se exponen al
  solicitante, ni en la vista ni en las notificaciones.
- **Notificaciones idempotentes.** Un evento reentregado no genera dos avisos al
  mismo destinatario por el mismo canal.
- **Degradación controlada.** Si un servicio interno cae, el circuito abre y el
  cliente recibe 503 en lugar de esperar; las pantallas que pueden mostrarse
  parciales lo hacen.

## Crear usuarios (técnicos y administradores)

Por la API, con un token de ADMIN:

```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"tecnico@cmm.uchile.cl","fullName":"Nombre Apellido","password":"ClaveDe12OMas",
       "role":"AGENT","department":"Soporte","skills":["NETWORK","HARDWARE"],"maxConcurrentTickets":15}'
```

Por consola — **es la única vía para el primer administrador**, porque la API exige un
ADMIN que todavía no existe:

```bash
npm run user:create -- --email=admin@cmm.uchile.cl --name="Nombre Apellido" --role=ADMIN

# Dentro del despliegue Docker:
docker compose --env-file .env -f docker/docker-compose.yml run --rm migrator \
  npm run user:create -- --email=admin@cmm.uchile.cl --name="Nombre" --role=ADMIN
```

La contraseña se genera y se imprime una sola vez. Para automatizar sin que quede en el
historial del shell: `echo "$CLAVE" | npm run user:create -- ... --password-stdin`.

Roles: `REQUESTER` (reporta), `AGENT` (atiende), `SUPERVISOR` (coordina y reasigna),
`ADMIN` (todo lo anterior más crear usuarios). Los `skills` de un agente son las
categorías en las que es especialista, y la asignación automática los usa.

## Tickets por correo

Los pedidos que llegan a `soporte@cmm.uchile.cl` se convierten en tickets. El buzón es
**dedicado** y no el de sistemas, porque ese recibe la salida de los crontab de los
servicios y cada uno sería un ticket falso.

- **Filtra el ruido**: descarta correo de máquinas por cabecera (`Auto-Submitted`),
  remitente (`root@`, `cron@`, `nagios@`) y asunto (`Cron <...>`, `Backup completed`).
- **Encadena respuestas**: un correo con `[TCK-000123]` en el asunto se agrega como
  comentario, no crea un ticket nuevo.
- **Da de alta al remitente** si escribe por primera vez, solo desde dominios
  autorizados.
- **Limpia el cuerpo**: quita firmas y texto citado, para que la descripción sea el
  pedido y no veinte líneas de ruido.
- **Deja constancia de todo**, incluidos los descartes y su motivo: la pregunta "¿por
  qué el correo de Fulano no generó ticket?" se contesta con una consulta.

Para probarlo sin tener el buzón creado:

```bash
mkdir -p correos-prueba/procesados
cp apps/email-ingestion-service/fixtures/*.eml correos-prueba/
# con MAIL_ADAPTER=simulado y MAIL_INGESTION_ENABLED=true en .env
npm run docker:up
```

Con el buzón real: `MAIL_ADAPTER=imap` contra `imap.gmail.com:993`. Google Workspace
exige una **contraseña de aplicación** de 16 caracteres, no la contraseña de la cuenta.

## Patrones implementados

API Gateway · BFF · Repository · Specification · Service Layer · Strategy ·
Factory · Observer · Circuit Breaker · Unit of Work

El detalle de dónde vive cada uno y cómo extenderlo está en [CLAUDE.md](./CLAUDE.md).

## Respaldos

```bash
npm run db:backup                        # dump verificado, con retención
npm run db:restore backups/<archivo>     # restaura en una base scratch y cuenta filas
```

La restauración de prueba no toca la base real: correrla es la única forma de
saber que el respaldo sirve. El WAL archiving está apagado, así que el RPO
efectivo es el intervalo entre respaldos.

## CI

`.github/workflows/ci.yml` corre los gates de más barato a más caro: estático
(`lint:ci` + tipos) → tests → `npm audit` → build de los 5 → migraciones contra un
Postgres real (`run → revert → run`) → imágenes con escaneo de CVEs. El detalle
está en `.github/workflows/README.md`.

## Verificación

```bash
npm run build   # compila los cinco servicios
npm test        # 99 tests
npm run lint
npm audit       # 0 vulnerabilidades
```

## Notas de seguridad

- Los microservicios escuchan en `127.0.0.1` por omisión y **autentican cada
  mensaje RPC** con `RPC_SHARED_SECRET`: alcanzar el puerto no alcanza para
  invocarlos.
- La autorización que depende del dato (¿este ticket es tuyo?) se resuelve en el
  microservicio y es *fail-closed*.
- Swagger se publica solo con `ENABLE_SWAGGER=true`, y en producción detrás de
  autenticación básica; el `/health` detallado requiere rol de supervisión.

El detalle de cada invariante y por qué existe está en [CLAUDE.md](./CLAUDE.md).

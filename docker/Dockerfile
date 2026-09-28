# Imagen parametrizada: los cinco servicios comparten este Dockerfile y se
# diferencian por APP_NAME, así no hay cinco Dockerfiles que divergen.
#
# Versión fija (no `22-alpine`): una etiqueta móvil hace que el mismo commit
# produzca runtimes distintos según el día. Subirla es un cambio deliberado.
ARG NODE_VERSION=22.23-alpine3.24

# --- Etapa de dependencias -------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Solo los manifiestos primero: así la capa de npm ci se reutiliza mientras no
# cambien las dependencias, aunque cambie el código.
COPY package*.json ./
RUN npm ci

# --- Etapa de build --------------------------------------------------------
FROM node:${NODE_VERSION} AS build
ARG APP_NAME
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx nest build ${APP_NAME}

# --- Etapa de herramientas (migraciones y alta de usuarios) ----------------
# Objetivo aparte porque necesita lo que el runtime no tiene: los .ts, el árbol de
# fuentes y ts-node. Sin él, desplegar un cambio de esquema o crear el primer
# administrador exigía tener el repo completo en alguna máquina y apuntarlo a mano
# contra la base de producción.
#
# Copia `apps` además de `libs` para que también sirva para `npm run user:create`:
#   docker compose run --rm migrator npm run user:create -- --email=... --role=ADMIN
FROM node:${NODE_VERSION} AS migrator
ENV NODE_ENV=development
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY package*.json tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY libs ./libs
COPY apps ./apps
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["npx", "ts-node", "-r", "tsconfig-paths/register", \
     "./node_modules/typeorm/cli.js", "migration:run", \
     "-d", "libs/database/src/data-source.ts"]

# --- Etapa de runtime ------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ARG APP_NAME
# Etiquetas OCI: con imágenes `:latest` y contenedores de larga vida, esto es lo
# único que permite saber qué versión está sirviendo tráfico.
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="ticketera-${APP_NAME}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV NODE_ENV=production
ENV APP_ENTRY=dist/apps/${APP_NAME}/main.js
ENV APP_VERSION=${GIT_SHA}
WORKDIR /app

# dumb-init da manejo correcto de señales: como PID 1 propaga SIGTERM al grupo de
# procesos, para que un `docker stop` cierre conexiones en lugar de matar el proceso.
RUN apk add --no-cache dumb-init

COPY package*.json ./
# `--omit=dev` es obligatorio y no es redundante con el build: el webpack de Nest
# externaliza node_modules, así que el bundle NO lleva las dependencias adentro.
#
# La imagen base trae su propia CLI de npm (con sus propias dependencias
# transitivas, fuera de nuestro package-lock.json) instalada globalmente. El
# runtime no la usa para nada -- el CMD de abajo llama a `node` directo -- así
# que una vez que terminó de instalar las dependencias de producción, se borra:
# sin eso, un scan de CVEs de la imagen final reporta vulnerabilidades de un
# binario que ni siquiera se ejecuta.
RUN npm ci --omit=dev && npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/dist ./dist

# No correr como root: si el proceso se compromete, no debe tener privilegios
# sobre la imagen ni sobre los volúmenes montados.
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "node $APP_ENTRY"]

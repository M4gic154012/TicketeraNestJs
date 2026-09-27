#!/usr/bin/env bash
#
# Respaldo lógico de la base.
#
# Formato custom (-Fc): comprimido, restaurable selectivamente por tabla y
# tolerante a diferencias de versión menor, a diferencia de un dump SQL plano.
#
# Pensado para correr desde cron/timer, así que TODO fallo es ruidoso y con código
# de salida distinto de cero: la forma en que los respaldos dejan de existir es en
# silencio.
#
# RPO de este mecanismo = el intervalo entre corridas. Para RPO de minutos hace
# falta además WAL archiving (archive_mode=on), que hoy está apagado.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# `source` bajo `set -e` mata el script sin mensaje si el archivo no existe: desde
# un cron eso es un respaldo que no se hizo y un log vacío.
[[ -f .env ]] || fail "no existe $REPO_ROOT/.env; el respaldo no puede conocer las credenciales"
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${DB_USER:?DB_USER no está definida en .env}"
: "${DB_NAME:?DB_NAME no está definida en .env}"
: "${DB_PASSWORD:?DB_PASSWORD no está definida en .env}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE="docker compose --env-file .env -f docker/docker-compose.yml"

# El contenedor se resuelve por el servicio del compose, no por un nombre fijo:
# así conviven varios stacks en el mismo host (staging junto a producción).
CONTAINER="${DB_CONTAINER:-}"
if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$($COMPOSE ps -q postgres 2>/dev/null || true)"
fi
[[ -n "$CONTAINER" ]] || fail "no se encontró el contenedor de postgres (¿está levantado el stack?)"

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
TARGET="${BACKUP_DIR}/ticketera-${STAMP}.dump"
TMP="${TARGET}.tmp"

mkdir -p "$BACKUP_DIR"

# Si el script muere a mitad, el temporal no queda contando como respaldo válido.
cleanup() { [[ -f "$TMP" ]] && rm -f "$TMP"; }
trap cleanup EXIT

echo "Respaldando ${DB_NAME} -> ${TARGET}"

# Se escribe al temporal y se renombra recién después de verificar: con la
# redirección directa al destino, un pg_dump fallido dejaba un archivo truncado
# con nombre válido que el conteo final contaba como bueno.
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-privileges \
  > "$TMP" || fail "pg_dump falló"

[[ -s "$TMP" ]] || fail "el dump quedó vacío"

# Un dump que no se puede leer no es un respaldo. pg_restore --list falla si el
# archivo está truncado o corrupto.
docker exec -i "$CONTAINER" pg_restore --list < "$TMP" > /dev/null \
  || fail "el dump generado no es legible; se descarta"

mv "$TMP" "$TARGET"
trap - EXIT

# Checksum registrado: permite detectar corrupción silenciosa del archivo o del
# disco mucho después, y verificar la copia que se envía fuera del host.
if command -v shasum > /dev/null; then
  (cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$TARGET")" >> checksums.txt)
fi

echo "Respaldo verificado ($(du -h "$TARGET" | cut -f1))"

# Retención: sin esto el disco se llena en silencio, que es la otra forma en que
# los respaldos dejan de existir.
find "$BACKUP_DIR" -name 'ticketera-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete
find "$BACKUP_DIR" -name '*.tmp' -type f -mtime +1 -delete 2>/dev/null || true

echo "Respaldos actuales: $(find "$BACKUP_DIR" -name 'ticketera-*.dump' | wc -l | tr -d ' ')"

# PENDIENTE OPERATIVO (no lo resuelve este script): copiar el dump FUERA de este
# host. Mientras viva en el mismo disco que el volumen postgres-data, el fallo más
# común —se muere el disco— se lleva la base y sus respaldos juntos. Sumá acá el
# rsync/rclone/scp al destino remoto, y cifrá el archivo si va a salir de la
# máquina: contiene datos personales y hashes de contraseña.

#!/usr/bin/env bash
#
# Restauración de un respaldo.
#
# Por defecto restaura en una base SCRATCH, no sobre la real: el uso que debería
# ser rutinario es *probar* que el respaldo sirve. Un respaldo nunca restaurado es
# una hipótesis, no una garantía.
#
#   bash scripts/restore.sh backups/ticketera-<stamp>.dump
#   bash scripts/restore.sh <archivo> --into-production   # sobrescribe la real
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ -f .env ]] || fail "no existe $REPO_ROOT/.env"
set -a
# shellcheck disable=SC1091
source .env
set +a

: "${DB_USER:?DB_USER no está definida}"
: "${DB_NAME:?DB_NAME no está definida}"
: "${DB_PASSWORD:?DB_PASSWORD no está definida}"

DUMP="${1:-}"
MODE="${2:-}"
COMPOSE="docker compose --env-file .env -f docker/docker-compose.yml"

CONTAINER="${DB_CONTAINER:-}"
if [[ -z "$CONTAINER" ]]; then
  CONTAINER="$($COMPOSE ps -q postgres 2>/dev/null || true)"
fi
[[ -n "$CONTAINER" ]] || fail "no se encontró el contenedor de postgres"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Uso: bash scripts/restore.sh <archivo.dump> [--into-production]" >&2
  exit 1
fi

psql_admin() {
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
    psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 "$@"
}

if [[ "$MODE" == "--into-production" ]]; then
  TARGET_DB="$DB_NAME"
  cat <<ADVERTENCIA
ATENCIÓN: se va a SOBRESCRIBIR la base '${TARGET_DB}'.

Procedimiento completo (este script cubre los pasos 2 y 3):
  1. Parar los servicios que escriben:
       $COMPOSE stop api-gateway bff-web users-service tickets-service notifications-service
  2. Restaurar (este script).
  3. Verificar el conteo de filas (este script lo imprime).
  4. Aplicar migraciones posteriores al dump:  npm run docker:migrate
  5. Levantar los servicios:                   $COMPOSE up -d

ADVERTENCIA
  read -r -p "Escribí el nombre de la base para confirmar: " CONFIRM
  [[ "$CONFIRM" == "$TARGET_DB" ]] || fail "cancelado"

  # Postgres rechaza DROP DATABASE mientras haya sesiones abiertas, y los tres
  # servicios están conectados de forma permanente: sin esto el único camino de
  # recuperación real fallaba exactamente cuando hace falta.
  echo "Cerrando conexiones a '${TARGET_DB}'..."
  psql_admin -c "REVOKE CONNECT ON DATABASE \"${TARGET_DB}\" FROM PUBLIC" > /dev/null 2>&1 || true
  psql_admin -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();" > /dev/null
else
  TARGET_DB="${DB_NAME}_restore_test"
  echo "Restauración de prueba en '${TARGET_DB}' (no toca '${DB_NAME}')."
fi

psql_admin -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\"" > /dev/null
psql_admin -c "CREATE DATABASE \"${TARGET_DB}\"" > /dev/null

docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  pg_restore -U "$DB_USER" -d "$TARGET_DB" --no-owner --no-privileges < "$DUMP" \
  || fail "pg_restore falló; la base '${TARGET_DB}' quedó incompleta"

if [[ "$MODE" == "--into-production" ]]; then
  psql_admin -c "GRANT CONNECT ON DATABASE \"${TARGET_DB}\" TO PUBLIC" > /dev/null 2>&1 || true
fi

echo "--- Verificación: filas por tabla ---"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  psql -U "$DB_USER" -d "$TARGET_DB" -c "
  SELECT 'users' AS tabla, COUNT(*) FROM users
  UNION ALL SELECT 'tickets', COUNT(*) FROM tickets
  UNION ALL SELECT 'ticket_comments', COUNT(*) FROM ticket_comments
  UNION ALL SELECT 'ticket_status_history', COUNT(*) FROM ticket_status_history
  UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
  UNION ALL SELECT 'migrations', COUNT(*) FROM migrations;"

if [[ "$MODE" == "--into-production" ]]; then
  echo "Restauración aplicada. Continuá con los pasos 4 y 5 del procedimiento."
else
  echo
  echo "Prueba OK. Para eliminar la base de prueba:"
  echo "  docker exec $CONTAINER psql -U $DB_USER -d postgres -c 'DROP DATABASE \"${TARGET_DB}\"'"
fi

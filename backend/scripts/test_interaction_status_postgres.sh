#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$BACKEND_DIR/docker-compose.interaction-test.yml"
DATABASE_URL="postgresql+asyncpg://creatorjobs_test:creatorjobs_test@127.0.0.1:55439/creatorjobs_interaction_test"
PYTHON_BIN=${PYTHON_BIN:-.venv/bin/python}

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker compose -f "$COMPOSE_FILE" up -d --wait

cd "$BACKEND_DIR"
export APP_ENV=test
export DATABASE_URL
export POSTGRES_TEST_DATABASE_URL="$DATABASE_URL"

"$PYTHON_BIN" -m alembic upgrade head
"$PYTHON_BIN" -m alembic downgrade 0038_interaction_participant_status
PYTHONPATH=. "$PYTHON_BIN" tests/interaction_migration_fixtures.py
"$PYTHON_BIN" -m alembic upgrade head
"$PYTHON_BIN" -m pytest \
  tests/test_auth_oauth_postgres.py \
  tests/test_interaction_migration_postgres.py \
  tests/test_interaction_transitions_postgres.py \
  -q

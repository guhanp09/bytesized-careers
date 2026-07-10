#!/usr/bin/env sh

# Render Free has no interactive shell, so staging can opt into migrations and
# deterministic demo seeding before the API process starts. Keep this script
# POSIX-compatible because it is invoked by the Docker image's /bin/sh.
set -eu

app_env="${APP_ENV:-development}"

parse_boolean_flag() {
  flag_name="$1"
  flag_value="$2"

  case "$flag_value" in
    1|true|TRUE|yes|YES|on|ON)
      printf '%s' "true"
      ;;
    0|false|FALSE|no|NO|off|OFF|"")
      printf '%s' "false"
      ;;
    *)
      printf '%s\n' "${flag_name} must be a boolean value such as true or false." >&2
      exit 2
      ;;
  esac
}

run_migrations="$(parse_boolean_flag "RUN_DB_MIGRATIONS" "${RUN_DB_MIGRATIONS:-false}")"
run_staging_seed="$(parse_boolean_flag "RUN_STAGING_SEED" "${RUN_STAGING_SEED:-false}")"

printf '%s\n' "Starting CreatorJobs backend..."
printf '%s\n' "APP_ENV=${app_env}"
printf '%s\n' "Running migrations: ${run_migrations}"
printf '%s\n' "Running staging seed: ${run_staging_seed}"

if [ "$run_migrations" = "true" ]; then
  printf '%s\n' "Running database migrations..."
  uv run alembic upgrade head
fi

if [ "$run_staging_seed" = "true" ]; then
  case "$app_env" in
    staging|development|test)
      printf '%s\n' "Running deterministic demo seed for ${app_env}..."
      uv run python scripts/seed_staging_demo.py --confirm "$app_env"
      ;;
    production)
      printf '%s\n' "Refusing to run staging demo seed when APP_ENV=production." >&2
      exit 1
      ;;
    *)
      printf '%s\n' "RUN_STAGING_SEED requires APP_ENV to be staging, development, or test." >&2
      exit 1
      ;;
  esac
fi

exec uv run uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

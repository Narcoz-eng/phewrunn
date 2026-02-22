#!/bin/bash
# Shared environment setup for backend scripts

ENVIRONMENT="${ENVIRONMENT:-development}"

# Load backend-local env files so Studio/start scripts use the same DB config
# as local `bun` commands (e.g. `.env.local` with Supabase URLs).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_env_file() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${file}"
    set +a
  fi
}

# Follow common precedence: base, environment, local overrides
load_env_file "${BACKEND_DIR}/.env"
load_env_file "${BACKEND_DIR}/.env.${ENVIRONMENT}"
load_env_file "${BACKEND_DIR}/.env.local"
load_env_file "${BACKEND_DIR}/.env.${ENVIRONMENT}.local"

if [[ "${ENVIRONMENT}" == "production" ]]; then
  echo "Starting in production mode..."
  export NODE_ENV="production"
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL must be set in production (use Supabase/Postgres)."
    echo "If you intentionally want SQLite, export DATABASE_URL=file:/path/to/db.sqlite first."
    exit 1
  fi
else
  echo "Starting in development mode..."
  export NODE_ENV="development"
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERROR: DATABASE_URL is not set."
    echo "Set it to your local/remote Postgres URL (Supabase) before starting the backend."
    exit 1
  fi
fi

#!/bin/bash
# Shared environment setup for backend scripts

ENVIRONMENT="${ENVIRONMENT:-development}"

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

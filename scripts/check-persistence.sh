#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Disposable local Postgres only. No published ports, remote URL, or Supabase credentials.
name="multimodal-persistence-check-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run --detach --rm --network none --name "$name" \
  -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:pg17 >/dev/null
for _ in {1..60}; do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
SQL

docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 \
  < supabase/migrations/20261020000000_sources_and_chunks.sql
docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/persistence.sql

echo "Persistence SQL checks passed. Disposable database removed on exit."

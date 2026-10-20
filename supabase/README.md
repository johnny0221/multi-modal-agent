# Phase 2: Supabase persistence foundation

**Nothing has been applied to your remote database automatically.** These files assume a local, single-user app and an existing Supabase development project. They do not add Auth or expose any new HTTP endpoints.

## 1. Understand the storage model

- Private Storage bucket `sources`: original files, at `<source UUID>/original` (original name stays in Postgres).
- `public.sources`: filename, MIME type, storage path, status, embedding model, creation time.
- `public.source_chunks`: ordered text, nullable page range, 1536-dimensional embedding, source foreign key.
- `match_source_chunks`: exact cosine search restricted to explicitly selected, **ready** sources. Similarity is `1 - cosine distance`; it is not a probability of correctness.

Unique `(source_id, chunk_index)` prevents duplicate positions. Database deletion cascades to chunks; Storage objects require separate deletion. The source service removes Storage first so failed deletion retains metadata for retry.

The corpus is fixed to `text-embedding-3-small`, 1536 dimensions. Both query and chunk embeddings must come from that same model/settings. Changing models requires schema/config review and re-embedding; changing chat models does not.

## 2. Configure secrets locally

From the project's **Connect** dialog, copy the project URL. From **Settings → API Keys**, create/copy a secret key (`sb_secret_...`). A legacy service-role key also works, but a publishable/anon key is deliberately denied access by this schema.

Add the following variables to your existing `.env`; do not overwrite your OpenAI settings:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=
```

Fill in the secret locally. Do not paste it into chat, commit it, put it in a URL, or use `NEXT_PUBLIC_`. The server client disables browser sessions and is protected by `server-only`.

**Secret keys bypass RLS.** RLS is enabled and anonymous/authenticated browser access is revoked, but the current server has privileged access. Before public/multi-user use, add Auth, ownership columns, authorization checks, and appropriate table/Storage/RPC policies. An API key identifies the app, not an individual user.

## 3. Review and apply the migration

Migration: `supabase/migrations/20261020000000_sources_and_chunks.sql`.

It creates tables, constraints, pgvector in `extensions`, and a server-only search RPC in one transaction. It does not drop existing tables. If the project already has tables with these names or a vector extension in another schema, stop and adapt the migration rather than deleting existing data/extensions.

The CLI project has been initialized (`config.toml` is generated local tooling configuration). It is not linked to a remote project. With Supabase CLI installed, run these yourself from the project root:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
# Review the project and pending migration before running:
supabase db push
```

Keep any CLI password/token prompts local. If migration history conflicts, stop; do not reset the database or force migrations. No `supabase start` or full local Supabase stack is required for this hosted setup.

## 4. Create private Storage bucket

In the dashboard, **Storage → New bucket**:

- Name/ID: `sources`
- Public: **OFF**
- The setup check uploads tiny `text/plain` fixtures; allow that MIME type if you configure restrictions.

Do not add browser access policies yet. The secret-backed server client handles fixture access. Real large-file uploads and their scoped authorization/resumable transport come in the ingestion phase.

### Troubleshooting bucket lookup

`getBucket("sources")` returns `{ data, error }`. A null `data` value with an authentication error does **not** mean the bucket is missing. `Invalid Compact JWS` indicates an invalid JWT/credential was sent. Copy the server secret from **Settings → API Keys**, not the database password, publishable key, or CLI access token. Ensure URL and key belong to the same project. Keep the bucket private; do not weaken RLS to work around authentication failures.

The integration check now reports configuration failures, Storage error status, missing data, and an accidentally public bucket separately. `.env` does not override already-exported shell variables, so clear stale shell values if changing `.env` has no effect.

## 5. Run checks, one boundary at a time

```bash
pnpm test          # Unit checks; no real credentials or provider calls
pnpm test:sql      # Docker: disposable pgvector/Postgres, no remote connections
pnpm test:supabase # Explicitly opts into YOUR configured dev project
```

The SQL check starts its own container with no published ports, applies the migration, tests cosine ranking, source scoping, readiness, limits, permissions, constraints and cascade deletion, then removes the container. It is not a test of hosted Supabase Storage/PostgREST.

The hosted check reads `.env`, requires a private `sources` bucket, creates two UUID-scoped tiny source files and synthetic vectors, verifies scoped retrieval, and deletes only its own fixtures. It does not call OpenAI or spend embedding credits. If cleanup fails, it reports source IDs needing retry. Use a development project, not production.

Synthetic vectors prove storage/ranking plumbing, **not semantic retrieval quality**. Real embedding/retrieval evaluation comes later.

## 6. Read the application flow

```text
source.service.ts
  → source.repository.ts → Supabase Storage + sources table
  → deletion: original file first, metadata/chunks second

future ingestion service
  → source status processing
  → chunk.repository.ts: insert batches of text + embeddings
  → source status ready only after successful ingestion

future chat service
  → embedding model generates query vector
  → chunk.repository.ts → match_source_chunks RPC
  → selected chunk text → chat model
```

Entry files:

- `src/dto/source.dto.ts`: row/input contracts, embedding constants and validation.
- `src/server/supabase/client.ts`: privileged server-only SDK client.
- `src/server/supabase/database.types.ts`: hand-written app-owned database shapes matching this migration, not types generated from your hosted project. Keep them aligned with future SQL changes.
- `src/server/sources/source.repository.ts`: metadata and original-file access.
- `src/server/sources/chunk.repository.ts`: insert chunks and cosine search.
- `src/server/sources/source.service.ts`: source storage/deletion lifecycle.

No upload UI, PDF parser, chunker, embedding generator, vector index, chat-history persistence, or chat-to-RAG wiring yet. `storeSource` uses a buffered Blob only for small setup fixtures; it is not the planned large-PDF upload transport.

### Learning experiment

Read the search function's `where` clause. Explain why both `source_id = any(...)` and `status = 'ready'` are needed. Then inspect the SQL check: an identical vector in another source must never appear in the selected source's results.

# Item 6 — Security check (shared-project / schema `wacrm`)

Self-review against [`docs/security-review-2026-10.md`](./security-review-2026-10.md) for **shared Supabase** mode (Chat beside Voice). No live DB apply in this pass — pack + app contracts only.

Companion smoke (when staging credentials exist): [`scripts/smoke-shared-project.mjs`](../scripts/smoke-shared-project.mjs).  
Schema pack: [`supabase/shared-project/wacrm_schema.sql`](../supabase/shared-project/wacrm_schema.sql).  
Isolation notes: [`docs/shared-project-migration.md`](./shared-project-migration.md).

## Scope map (CHAT-12 → shared-project)

| CHAT-12 theme ([security-review-2026-10](./security-review-2026-10.md)) | Shared-project expectation | Status |
| --- | --- | --- |
| API authentication (middleware, `requireRole`, Connect HMAC, route audit) | Unchanged; Connect/read still fail-closed | **OK** — existing suites |
| Tenant isolation (`account_id` + RLS) | Authoritative RLS lives on **`wacrm.*`**, not `public.*` | **OK** — pack + `wacrm-rls-coverage` test |
| Webhook / Connect signatures | Same HMAC contracts; no schema dependency | **OK** |
| Rate limits | In-process limits unchanged | **OK** (Redis gap remains as in CHAT-12) |
| XSS / message rendering | Unchanged | **OK** |
| Staging RLS probes | Owner credentials + smoke script | **Ready** — smoke not run here (no shared DB in this agent) |

## Shared-project controls

### 1. Service role key — server only

| Control | Evidence |
| --- | --- |
| Key read only from `SUPABASE_SERVICE_ROLE_KEY` | [`src/lib/supabase/admin.ts`](../src/lib/supabase/admin.ts) `createServiceClient()` |
| Not prefixed `NEXT_PUBLIC_` | No `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE` in repo |
| Browser client uses anon + user JWT | [`src/lib/supabase/client.ts`](../src/lib/supabase/client.ts) |
| Smoke sends `sb_secret_*` as **`apikey` only** (never `Authorization: Bearer`) | `scripts/smoke-shared-project.mjs` `serviceFetch` |
| Seed / staging scripts take service key from env, never log it | `deploy/staging/scripts/seed-demo-data.mjs` |

### 2. No service key in the client bundle

| Control | Evidence |
| --- | --- |
| Production build runs `scripts/scrub-client-bundles.mjs` after `next build` | `package.json` `build` script |
| Client env is limited to URL / anon / public schema + bucket prefix | `NEXT_PUBLIC_SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_DB_SCHEMA`, `NEXT_PUBLIC_STORAGE_BUCKET_PREFIX` |

### 3. RLS on every `wacrm` table

| Control | Evidence |
| --- | --- |
| `ALTER TABLE wacrm.<t> ENABLE ROW LEVEL SECURITY` for all `CREATE TABLE wacrm.<t>` | Pack + [`src/lib/supabase/wacrm-rls-coverage.test.ts`](../src/lib/supabase/wacrm-rls-coverage.test.ts) |
| ≥1 `CREATE POLICY … ON wacrm.<t>` per table | Same test |
| Service-only tables use explicit **deny-all** (`USING (false)`) | `astra_usage_daily`, `astra_connect_handoff_audit`, `automation_pending_executions` |
| Generator emits deny-all for RLS tables that otherwise have zero policies | [`scripts/generate-wacrm-schema.mjs`](../scripts/generate-wacrm-schema.mjs) |

### 4. Grants scoped

| Control | Evidence |
| --- | --- |
| `GRANT USAGE ON SCHEMA wacrm TO anon, authenticated, service_role` | Pack header |
| Table DML: `GRANT ALL ON ALL TABLES IN SCHEMA wacrm TO authenticated, service_role` — **not** anon | Pack footer |
| Sensitive RPCs `REVOKE … FROM PUBLIC` / anon / authenticated as appropriate | Pack revokes block |
| Storage policies scoped to `bucket_id = 'wacrm-*'` | [`supabase/shared-project/shared_storage.sql`](../supabase/shared-project/shared_storage.sql) |
| No `auth.users` triggers; profile via `wacrm.ensure_chat_profile` | Pack + CHAT shared-project safety tests |

### 5. PostgREST profile isolation

| Control | Evidence |
| --- | --- |
| App clients set `db.schema` from `SUPABASE_DB_SCHEMA` | [`src/lib/supabase/config.ts`](../src/lib/supabase/config.ts) |
| Smoke asserts every `/rest/v1` call uses `Accept-Profile` / `Content-Profile: wacrm` | `scripts/smoke-shared-project.mjs` |
| Seed honours `SUPABASE_DB_SCHEMA` + `STORAGE_BUCKET_PREFIX` | `deploy/staging/scripts/seed-demo-data.mjs` |

## Smoke checklist (staging — when credentials available)

| Check | Script row |
| --- | --- |
| PostgREST reaches `wacrm` | `postgrest-wacrm` |
| Anon cannot read sample tables | `rls-anon` |
| Signup/login → `ensure_chat_profile` | `ensure_chat_profile` / `profile-row` |
| Authenticated user only sees own `account_id` | `rls-authenticated` |
| Upload/download under `wacrm-*` bucket | `storage-upload` / `storage-download` |
| Signed Connect read against `STAGING_APP_URL` | `read-api-signed` / `read-api-bad-sig` |
| Tagged seed write + readback + cleanup | `seed-write` / `seed-readback` / `seed-cleanup` |
| No non-`wacrm` PostgREST profile | `no-public-schema` |
| Service calls: apikey without Bearer | `service-apikey-only` |

## Residual gaps (unchanged from CHAT-12)

- In-memory rate limiter is single-process; multi-instance needs Redis.
- Full live RLS proof requires shared-project owner credentials (smoke above).
- Password login remains client → Supabase Auth (platform limits).

## Verdict

**Pass for shared-project mode on paper:** service key stays server-side, client bundle contract + scrub remain, every `wacrm` table has RLS + ≥1 policy (deny-all where service-only), grants exclude anon table DML, storage/schema prefixes isolate Chat from Voice. Run `node scripts/smoke-shared-project.mjs` on staging to close the live probe gap.

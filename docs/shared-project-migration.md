# Shared Supabase project — objects outside `wacrm`

This document lists every **non-`wacrm`** surface touched when installing or running Astra Chat on a shared Supabase project alongside Voice (or other products). Use it for security review and teardown planning.

**Rollback:** run [`supabase/shared-project/rollback_wacrm.sql`](../supabase/shared-project/rollback_wacrm.sql).

## Install order

Pack: shared-sql-v3 under [`supabase/shared-project/`](../supabase/shared-project/) (`SHA256SUMS`, `VERIFY.md`, `CODE-CHANGES.md`, `verify/`).

1. [`live-precheck.sql`](../supabase/shared-project/live-precheck.sql) — read-only preflight (ends in `ROLLBACK`)
2. [`wacrm_schema.sql`](../supabase/shared-project/wacrm_schema.sql) — schema `wacrm` (tables, RLS, functions, grants)
3. [`shared_storage.sql`](../supabase/shared-project/shared_storage.sql) — private buckets + `storage.objects` policies
4. [`shared_realtime.sql`](../supabase/shared-project/shared_realtime.sql) — `supabase_realtime` publication
5. [`shared_cron.sql`](../supabase/shared-project/shared_cron.sql) — no-op (HTTP cron only)
6. [`shared_postgrest.md`](../supabase/shared-project/shared_postgrest.md) — expose `wacrm` in API settings

## App env (Chat)

| Variable | Shared-project value | Notes |
|----------|----------------------|-------|
| `SUPABASE_DB_SCHEMA` | `wacrm` | Also set `NEXT_PUBLIC_SUPABASE_DB_SCHEMA=wacrm` for the browser client |
| `STORAGE_BUCKET_PREFIX` | `wacrm-` | Also set `NEXT_PUBLIC_STORAGE_BUCKET_PREFIX=wacrm-` for client uploads |
| Default (local) | schema `public`, prefix `''` | Existing single-tenant deploys unchanged |

Profile bootstrap: no `auth.users` trigger. First Chat login calls RPC `ensure_chat_profile` (see `src/lib/auth/ensure-chat-profile.ts`).

## `auth.users` (read-only FK references)

`wacrm` tables reference `auth.users(id)` for identity and assignment. **No triggers** are installed on `auth.users` in the shared pack; profile bootstrap uses `wacrm.ensure_chat_profile()` (RPC) on first Chat login.

| Table / column | Purpose |
|----------------|---------|
| `profiles.user_id` | Primary link to Supabase Auth user |
| `contacts.user_id` | Owning agent (audit / legacy) |
| `tags.user_id`, `custom_fields.user_id`, `contact_notes.user_id` | Row author |
| `conversations.user_id` | Inbox owner |
| `whatsapp_config.user_id` | Config author |
| `message_templates.user_id` | Template author |
| `pipelines.user_id`, `deals.user_id`, `broadcasts.user_id` | CRM author |
| `automations.user_id`, `automation_logs.user_id`, `automation_pending_executions.user_id` | Automation author |
| `flows.user_id`, `flow_runs.user_id` | Flow author |
| `accounts.owner_user_id` | Account owner |
| `account_invitations.created_by_user_id`, `accepted_by_user_id` | Invite audit |
| `member_presence.user_id` | Presence row |
| `notifications.user_id`, `actor_user_id` | Recipient / actor |
| `api_keys.created_by` | Key creator |
| `webhook_endpoints.created_by` | Endpoint creator |
| `ai_configs.created_by` | AI settings author |
| `ai_knowledge_documents.created_by`, `ai_usage_log` (if present) | AI audit |
| `quick_replies.user_id` | Snippet author |
| `payment_links.created_by` | Link creator |
| `integration_connections.connected_by` | Connector author |
| `astra_connect_handoff_audit`, `astra_usage_daily` (created_by if present) | Connect audit |

(Exact column set matches generated [`wacrm_schema.sql`](../supabase/shared-project/wacrm_schema.sql); grep `REFERENCES auth.users` after apply.)

## `extensions` schema

| Extension | Reason |
|-----------|--------|
| `uuid-ossp` | `uuid_generate_v4()` defaults |
| `vector` | AI knowledge semantic search (`ai_knowledge_chunks.embedding`) |

Installed as `CREATE EXTENSION ... WITH SCHEMA extensions;` — shared cluster extension, not owned by Voice alone.

## `storage.buckets` and `storage.objects`

| Bucket ID | Purpose |
|-----------|---------|
| `wacrm-avatars` | Profile avatars (2 MB, images) — **private** |
| `wacrm-flow-media` | Flow builder media (16 MB) — **private** |
| `wacrm-chat-media` | Inbox / inbound mirrored media (16 MB, extended MIME list) — **private** |

Policies in `shared_storage.sql` are scoped to `bucket_id = 'wacrm-*'` and read `wacrm.profiles` for account folder checks. Buckets are `public = false` (shared-sql-v3). The app persists **Storage object paths** (not public URLs) and mints signed URLs at display time (short TTL) and Meta-send time (longer TTL). See [`CODE-CHANGES.md`](../supabase/shared-project/CODE-CHANGES.md).

## `supabase_realtime` publication

Adds (if missing): `wacrm.messages`, `wacrm.conversations`, `wacrm.message_reactions`, `wacrm.flow_runs`, `wacrm.member_presence`, `wacrm.notifications`.

App realtime subscriptions use `schema: getSupabaseDbSchema()` (so `SUPABASE_DB_SCHEMA=wacrm` on the shared project).

## PostgREST / API configuration

Dashboard: add **`wacrm`** to exposed schemas (`db-schemas`). Does not modify Voice schemas.

## Auth / ownership notes (shared-sql-v3)

- **No `auth.users` trigger.** First Chat login calls `ensure_chat_profile` (no direct `profiles` insert fallback).
- **`authenticated` has no INSERT on `wacrm.profiles`** (and `profiles_insert` is dropped). Only `ensure_chat_profile` / `redeem_invitation` create profile rows.
- **Invitation peek** (`GET /api/invitations/[token]/peek`) uses the service-role client — `anon` has no `wacrm` USAGE.
- **`accounts.owner_user_id` is ON DELETE CASCADE.** Any admin auth-user delete for an owner must call `transfer_account_ownership` first (see `src/lib/auth/safe-delete-auth-user.ts`).
- **Rollback:** [`rollback_wacrm.sql`](../supabase/shared-project/rollback_wacrm.sql) (empty buckets first; sets `storage.allow_delete_query`). Pre-install: [`live-precheck.sql`](../supabase/shared-project/live-precheck.sql). Verification notes: [`VERIFY.md`](../supabase/shared-project/VERIFY.md).

## pg_cron

None in migrations 001–058. Chat uses application HTTP cron routes. [`shared_cron.sql`](../supabase/shared-project/shared_cron.sql) is a no-op.

## What is intentionally **not** touched

- `public.*` Voice tables and functions
- Triggers on `auth.users`
- Non–`wacrm-*` storage buckets
- Voice realtime publication entries

# Shared Supabase project — objects outside `wacrm`

This document lists every **non-`wacrm`** surface touched when installing or running Astra Chat on a shared Supabase project alongside Voice (or other products). Use it for security review and teardown planning.

**Rollback:** run [`supabase/shared-project/rollback_wacrm.sql`](../supabase/shared-project/rollback_wacrm.sql).

## Install order

1. [`supabase/shared-project/wacrm_schema.sql`](../supabase/shared-project/wacrm_schema.sql) — schema `wacrm` (tables, RLS, functions, grants)
2. [`supabase/shared-project/shared_storage.sql`](../supabase/shared-project/shared_storage.sql) — buckets + `storage.objects` policies
3. [`supabase/shared-project/shared_realtime.sql`](../supabase/shared-project/shared_realtime.sql) — `supabase_realtime` publication
4. [`supabase/shared-project/shared_cron.sql`](../supabase/shared-project/shared_cron.sql) — no-op (HTTP cron only)
5. [`supabase/shared-project/shared_postgrest.md`](../supabase/shared-project/shared_postgrest.md) — expose `wacrm` in API settings

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
| `wacrm-avatars` | Profile avatars (2 MB, images) |
| `wacrm-flow-media` | Flow builder media (16 MB) |
| `wacrm-chat-media` | Inbox / inbound mirrored media (16 MB, extended MIME list) |

Policies in `shared_storage.sql` are scoped to `bucket_id = 'wacrm-*'` and read `wacrm.profiles` for account folder checks.

## `supabase_realtime` publication

Adds (if missing): `wacrm.messages`, `wacrm.conversations`, `wacrm.message_reactions`, `wacrm.flow_runs`, `wacrm.member_presence`, `wacrm.notifications`.

## PostgREST / API configuration

Dashboard: add **`wacrm`** to exposed schemas (`db-schemas`). Does not modify Voice schemas.

## pg_cron

None in migrations 001–058. Chat uses application HTTP cron routes.

## What is intentionally **not** touched

- `public.*` Voice tables and functions
- Triggers on `auth.users`
- Non–`wacrm-*` storage buckets
- Voice realtime publication entries

# shared-sql-v2: verification (box harness only)

Generated at 2026-10-28 (IST) from branch `cursor/astra-connect-adapter-f6ad` @ c678ea9, migrations 001–058.
**No remote database was contacted.** Everything ran against the local PG17 harness at `/tmp/wacrm-review-pg` (unix socket, port 55439) in my own scratch DBs:
- `v2ref`: stubs + 001–058, used as the reference
- `v2pack`: stubs + this pack

Voice's `ref` and `pack` DBs were only read, by the last line of verify.sh. `service-role.env` was never opened.

## Result: PASS

| Check | Result |
|---|---|
| Clean install (4 files, ON_ERROR_STOP) | PASS: all exit 0 |
| Voice exploit.sql T1–T8 | PASS: every exploit fails (table below) |
| Extra storage/grant tests S1–S13 | PASS: all as expected |
| Catalog diff vs migrated 058 ref | PASS: empty apart from the schema name and exceptions E1–E6 |
| Install twice | PASS: schema and storage fail cleanly (exit 3, nothing changed); realtime and cron are idempotent no-ops |
| Rollback pre-checks | PASS: aborts on non-empty bucket and on a foreign dependent object |
| Rollback | PASS: wacrm, the 12 wacrm_* policies and 3 buckets are gone; foreign policy, bucket and object kept; publication back to 0 tables; extensions kept |
| Rollback twice | PASS: no-op, exit 0 |
| Reinstall after rollback | PASS |

## How it was built
1. `pg_dump --schema-only --schema=public --no-owner --no-privileges` of v2ref, then transformed by `verify/gen.py` (deterministic, with assertions). gen.py:
   - strips `\restrict` lines and drops `handle_new_user`
   - rewrites `public.` to `wacrm.`, including function bodies; no `public` identifier is left (asserted)
   - pins `search_path = wacrm, extensions` on all 28 functions (asserted)
   - restores the real `extensions.vector(1536)` type and hnsw index
   - appends `ensure_chat_profile` verbatim from d202a03 and the explicit grants
2. File header: `BEGIN; SET LOCAL search_path = wacrm, extensions;` plus a guard DO block. The guard aborts if wacrm exists, if `extensions.uuid_generate_v4()` is missing, or if vector is installed outside extensions. The file ends in `COMMIT`.
3. Object order is pg_dump's (types → functions → tables → constraints/indexes → triggers → policies), so `is_account_member` exists before any policy. REPLICA IDENTITY is a separate ALTER. There are no duplicate constraints and only the 8-arg `create_broadcast_with_recipients`. The CHECK constraints come from the catalog, not hand edits, so there is no corruption.

### Harness note (vector)
The box cluster has no pgvector. `verify/testify.sh` maps only for the test install:
- `extensions.vector(1536)` → `real[]` (`::float4[]` in casts)
- hnsw → `btree(id)`
- the `CREATE EXTENSION vector` line is removed

This matches the stand-in that m_030/m_032 used in v2ref. **The shipped file uses the real vector type. That one line plus the hnsw index were never executed against pgvector here.**

## Commands
```
export PGHOST=/tmp/wacrm-review-pg PGPORT=55439 PGUSER=postgres
verify/verify.sh > verify/verify.out 2>&1     # whole suite, rebuilds v2pack from scratch
# per file it runs:  psql -X -q -v ON_ERROR_STOP=1 -d v2pack -f <file>
# order: wacrm_schema.sql, shared_storage.sql, shared_realtime.sql, shared_cron.sql
# catalog: psql -XAt -d v2ref -v schema=public -f verify/cat_norm.sql  vs  -d v2pack -v schema=wacrm
```
Full outputs: `verify/verify.out`, `verify/exploit.out`, `verify/exploit_extra.out`, `verify/catalog.diff` (full, including privileges), `verify/catalog_noacl.diff` (non-privilege only).

## Exploit results
| # | Attack | Result |
|---|---|---|
| T1 | voice-only authenticated user inserts message into B's conversation | `new row violates row-level security policy for table "messages"` |
| T2 | tenant A moves own profile into B as owner | `account_role and account_id cannot be changed directly…`; A sees 0 B contacts |
| T3 | authenticated calls service-only DEFINER fns | `permission denied for function bump_conversation_on_inbound` / `increment_flow_execution_count` |
| T4 | authenticated TRUNCATE | `permission denied for table notifications` |
| T5 | anon executes DEFINER fns | `permission denied for schema wacrm` (both) |
| T6 | delete voice auth user who owns a Chat account | DELETE 1 (CASCADE, see E3) |
| T7 | delete voice-only auth user | DELETE 1 |
| T8 | duplicate account for same owner | `duplicate key … "idx_accounts_one_per_owner"` |
| final | messages in B conversation | 0 |
| S1 | tenant A lists wacrm objects | only own `account-<A>/a.png` |
| S2 | A uploads into B's `account-<B>/` prefix | RLS error |
| S3 | A uploads into own prefix | INSERT 0 1 |
| S4 | malformed prefix (`account-not-a-uuid/`) | RLS error (no cast error) |
| S5 | A uploads avatar into B's user folder | RLS error |
| S6 | A deletes B's object | DELETE 0 |
| S7 | voice-only user lists wacrm objects | 0 |
| S8 | existing voice storage policy still works | 1 |
| S9 | anon lists objects / wacrm tables / peek_invitation | 0 / permission denied for schema wacrm |
| S10 | authenticated: merge_duplicate_contacts, claim_ai_reply_slot, notifications UPDATE of title | permission denied (all); UPDATE read_at OK |
| S11 | user RPCs (is_account_member, touch_presence, …) | work |
| S12 | service_role calls service-only fn | works |
| S13 | delete owner B | B's account and profiles removed (0/0) |

## Catalog diff (non-privilege; full text in verify/catalog_noacl.diff)
Compared: tables, columns (type/default/null), constraints, indexes, triggers, policies (cmd/roles/qual/check), function signatures, SECURITY DEFINER, proconfig, body md5 (with `public.`/`wacrm.` normalised), RLS, replica identity, enums, sequences.
Buckets and the publication were compared separately (names with `wacrm-` stripped). What remains is listed below; nothing else differs (no missing triggers, uniques, checks or policies):
```
CON accounts_owner_user_id_fkey … ON DELETE RESTRICT  →  ON DELETE CASCADE                (E3)
FN handle_new_user()  removed;  FN ensure_chat_profile(text) added                          (E2)
FN _bcast_cols_for_status, update_ai_configs_updated_at, update_ai_knowledge_documents_updated_at,
   update_updated_at_column: cfg ''  →  search_path=wacrm, extensions (bodies identical)     (E4)
BKT avatars / chat-media / flow-media: public=true → false (limits and MIME lists identical) (E5)
PUB: same 6 tables (conversations, flow_runs, member_presence, message_reactions, messages, notifications)
```

## Exceptions (intended differences vs the 058 end state)
- **E1. Privileges.**
  - Schema: PUBLIC and anon revoked; USAGE granted to authenticated and service_role.
  - Tables: authenticated gets SELECT/INSERT/UPDATE/DELETE on 51 tables. On notifications it gets SELECT/INSERT/DELETE plus UPDATE(read_at) only, the same column grant as the ref. service_role gets ALL. There is no blanket GRANT ALL to other roles and no TRUNCATE/REFERENCES/TRIGGER for authenticated.
  - Functions: PUBLIC EXECUTE revoked everywhere; explicit EXECUTE per function:
    - service_role only: `_bcast_bump, recompute_broadcast_counts, bump_conversation_on_inbound, increment_flow_execution_count, increment_automation_execution_count, claim_ai_reply_slot, record_webhook_failure, create_broadcast_with_recipients(8-arg)`
    - authenticated + service_role: `is_account_member, filter_contacts_by_tags, match_ai_knowledge_fts, match_ai_knowledge_semantic, peek_invitation, redeem_invitation, remove_account_member, set_member_role, transfer_account_ownership, touch_presence, ensure_chat_profile`
    - no grants (owner only): trigger functions, `_bcast_cols_for_status`, `merge_duplicate_*`
  - The ref had PUBLIC EXECUTE (DEFAULT) and an anon/PUBLIC grant on claim_ai_reply_slot.
- **E2. No trigger on auth.users.** `handle_new_user` and its trigger are dropped. `wacrm.ensure_chat_profile(p_full_name)` from d202a03 (SECURITY DEFINER, pinned search_path) is called by the app instead.
- **E3. `accounts.owner_user_id` ON DELETE CASCADE (was RESTRICT).**
  - Why: on a shared auth project, RESTRICT means Voice (or an admin) can't delete an auth user who happens to own a Chat account, and the error surfaces in another product. The column is NOT NULL with one account per owner (idx_accounts_one_per_owner), so SET NULL would need schema and app changes.
  - Every other FK to auth.users is already CASCADE or SET NULL.
  - Risk: deleting an owner deletes the whole tenant, including teammates' profiles (test S13).
  - Mitigation: transfer ownership first (`transfer_account_ownership`), and back up or export before deleting users.
- **E4. search_path pinned** on the 4 functions that had none (only proconfig changed; bodies identical).
- **E5. Storage (shared_storage.sql).**
  - Buckets `wacrm-avatars`, `wacrm-flow-media`, `wacrm-chat-media`: `public=false`, same size limits and MIME lists as the ref. `ON CONFLICT (id) DO NOTHING`, then a post-check aborts if any wacrm-* bucket is public.
  - 12 policies, all named `wacrm_*` (no collision with `maya_objects_*`), all `TO authenticated`:
    - chat-media / flow-media, all ops: first folder must be `account-<uuid>` and `wacrm.is_account_member(<uuid>)`. A malformed prefix yields NULL, which is denied.
    - avatars: write/update/delete only in own `<auth.uid()>/` folder. Select: own folder, or the folder of a user who shares an account with the caller.
  - Dropped the legacy user-id-folder alternative on flow-media. The app writes `account-*` only and this is a fresh install.
  - The guard aborts if `wacrm.is_account_member` is missing or any `wacrm_*` policy already exists.
- **E6. Shared change outside wacrm:** `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions` (live: not installed, 0.8.2 available). It is required for `ai_knowledge_chunks.embedding vector(1536)` and the hnsw index. Rollback does not drop it.

Realtime (`shared_realtime.sql`): aborts if the publication is missing or `FOR ALL TABLES`. It then keeps Voice's guarded `ALTER PUBLICATION … ADD TABLE` for the 6 tables (idempotent).
Cron (`shared_cron.sql`): no-op; migrations 001–058 schedule no pg_cron jobs.

## Rollback (rollback_wacrm.sql)
- Prerequisite, run manually: empty the three wacrm-* buckets via the Storage API. The script **never deletes from storage.objects** (comment in the file) and aborts if any object remains.
- pg_depend pre-check: aborts, listing the objects, if anything outside wacrm depends on a wacrm object.
  - Sub-objects (defaults, policies, triggers, rules, constraints) are resolved to their owning table.
  - Exempt: our own `wacrm_*` storage policies and publication membership.
  - Tested: a `public.foreign_dep` view is caught.
- Steps, in one transaction:
  1. unschedule `wacrm_%` cron jobs if pg_cron exists
  2. drop the 12 `wacrm_*` policies
  3. delete the 3 bucket rows
  4. `DROP SCHEMA wacrm CASCADE`, which removes the publication entries too
- Untouched: extensions (vector, uuid-ossp), other buckets, policies and objects.
- Run before install, so the live state is as Voice reported: `live-precheck.sql` (READ ONLY transaction, ends in ROLLBACK).

# WhatsApp Embedded Signup — Phase 1, Round 5 (Voice SQL review)

Task branch: `feat/wa-embedded-signup`. Round 5 base: `c7d0e564416b41a99a19d80ab6c373a850b9fd94`.

This document describes the current implementation and supersedes earlier-round behavior notes. Historical validation manifests remain in `CODE-CHANGES/validation/`.

## Configuration and scope

`WACRM_EMBEDDED_SIGNUP=1` enables the new endpoints and card; default off means hidden UI and 404 responses from all three endpoints. Configuration names are `META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`, `META_GRAPH_VERSION` (default `v26.0`), `NEXT_PUBLIC_META_GRAPH_VERSION`, and `WACRM_TOKEN_ENC_KEY` (base64-encoded 32-byte key). Real values must never enter source control or logs.

Graph version bump: the global default in `src/lib/whatsapp/meta-api.ts` moved from `v21.0` (previously hard-coded) to `v26.0` via `process.env.META_GRAPH_VERSION || 'v26.0'`. Reason: older versions are nearing Meta's end of support. Override with `META_GRAPH_VERSION`; `.env.example` documents it. Test: `src/lib/whatsapp/meta-api.version.test.ts`.

Meta setup requires Facebook Login for Business with the Embedded Signup configuration ID, the appropriate domains/OAuth configuration, permissions, App Review and webhook subscriptions. This task does not change a live Meta app or server environment. Sending/templates, token-health/reconnect monitoring, AI replies and CRM/billing remain later-phase work.

## Current behavior, including Round 5 fixes

### A. Reconnect without disrupting a connected number

- The ownership pre-check reads only `account_id,status,updated_at`, never another account's PIN ciphertext. Only when the row belongs to the current account does a second query read `pin_ciphertext`, filtered by both phone ID and account ID. Same-account retries reuse that PIN; new numbers and cross-account takeovers generate a fresh six-digit PIN. A former account's ciphertext is neither loaded by the pre-check nor supplied/returned for a takeover.
- The atomic SQL claim retains `COALESCE(c.pin_ciphertext, EXCLUDED.pin_ciphertext)` only when the OLD row's account matches the incoming account. Otherwise it stores `EXCLUDED.pin_ciphertext`. SET expressions read the old row even though `account_id` is reassigned in that SET. Its service-only return includes the post-claim `claimed_pin_ciphertext`, so registration uses the winning account's PIN. Deterministic unit tests verify fresh takeover PINs, no former ciphertext returned, and the existing 409 `pin_mismatch` recovery path if Meta rejects the fresh PIN.
- A connected row keeps its live token, connected status and metadata during register/subscribe. New rows and non-connected claims become pending. The new token/metadata become active only after both Meta operations succeed.
- The claim returns `stored_token_ciphertext` (renamed from the misleading previous-token OUT name). This is the **post-upsert** stored value: new token for a pending claim, unchanged old token for a connected claim. It is used for restoration **only when `wasConnected` is true**, and never as a token to revoke. A code comment records this distinction. A failed connected reconnect restores that token and the connected status rather than marking the live connection error. Other claimed rows become error. Both final activation and recovery updates match account, row ID, and the claimed status (`connected` for an active reconnect, `pending` otherwise), and select updated IDs. Zero updated rows returns HTTP 409 `state_changed`; a concurrent disconnect/transfer wins and is never restored over. Other recovery-write failures cannot mask the original Meta error. No ciphertext snapshot is included in the HTTP response.
- Meta error **133005**, specifically from `/register`, becomes HTTP 409 with `code: 'pin_mismatch'`, a matching `error` field, and instructions to turn off two-step verification for the number in WhatsApp Manager before retrying. The card renders localized recovery instructions. Other Graph failures remain failures; unrelated endpoints returning this code are not reclassified as a register PIN mismatch.

The exact PIN code was verified on 30 October 2026 by directly retrieving Meta's official Cloud API error reference, which identifies 133005 as an incorrect two-step verification PIN. No subcode/message guess is used:

- https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration

A generic “already registered” error still is not treated as success: no benign code/subcode contract has been verified. PIN reuse addresses reconnects without inventing such an exception or automatically deregistering a number.

### B. Recover transferable or stuck numbers, while protecting legacy ownership

The application pre-check and atomic SQL predicate allow a different account to claim a disconnected or error row, or a pending row whose `updated_at` is **strictly older than 15 minutes**. SQL updates `account_id = EXCLUDED.account_id` and refreshes `updated_at`. The winning transfer becomes fresh pending, so another account cannot steal it. Connected rows and fresh pending rows remain protected against a different account. The current account can still retry its own row. Invalid/missing pending timestamps cannot bypass the application pre-check; SQL remains the authoritative race arbiter.

Before any claim, register or subscribe, connect also checks `wacrm.whatsapp_config` for the same `phone_number_id` owned by another account. A match returns HTTP 409 `number_in_use_legacy`; a lookup error fails closed with 500. The same account's legacy config is allowed. This guard applies even when a `wa_connections` row would otherwise be recoverable.

Tests cover error/stale-pending recovery, connected/fresh-pending rejection, the exact 15-minute boundary, invalid timestamps, legacy ownership and lookup failure, and concurrent transfer claims with exactly one winner.

### C. Keep shared WABA subscriptions alive

Disconnect checks for another connected or pending row with the same `waba_id`, excluding the target row. This service-side check includes all accounts sharing that WABA. Disconnect also checks for **any** row in `wacrm.whatsapp_config` with the same WABA, without filtering status or account. If an embedded sibling or legacy row exists, only the target row is marked disconnected; no Meta DELETE occurs. Either lookup failing closes the request with 500, without unsubscribe or a local status change. Without siblings, a failed unsubscribe returns 502 and marks error; a successful unsubscribe marks disconnected.

Disconnect and connection-list authentication errors preserve their typed status (401 remains 401, 403 remains 403). Database errors remain 500. Metadata listing never exposes token/PIN ciphertext.

### D. Distinguish missing and inactive webhook mappings

`resolveEmbeddedWebhookConnection()` returns distinct `not_found` and `not_connected` results. With the flag enabled:

- A connected mapping resolves its account owner via `wacrm.profiles.account_role` and decrypts its token server-side.
- Only `not_found` can fall back to the legacy `whatsapp_config` lookup. A missing legacy configuration is also dropped. Legacy fallback preserves account, owner and inbound-media settings, and status updates use that resolved account.
- Existing pending/disconnected/error mappings, lookup errors, ambiguous mappings, missing owners and corrupt tokens fail closed; they cannot use a stale legacy token.

A mapping lookup DB error emits only the constant diagnostic `[webhook] embedded connection lookup failed; skipping event`. Phone/account IDs, tokens, PINs, OAuth codes and raw database errors are excluded. A console-spy request test verifies the diagnostic and the skipped event.

The per-IP rate limiter is restored **before** body reading and mandatory HMAC verification. Rate-limited requests do not read the body or run HMAC. Allowed requests must still pass `x-hub-signature-256` verification before parsing/processing. Flag-off legacy behavior remains covered by the original webhook tests. Status updates are scoped through the resolved account's conversations/broadcasts because Meta message IDs can repeat across numbers.

### Sanitized stored errors

Connect and disconnect both use `sanitizeLastError()` before writing non-null `last_error`. Only a validated non-negative numeric Meta code and a fixed allowlisted message are included; missing/invalid Meta codes use a safe WhatsApp prefix without inventing a code. Unknown error classifications collapse to a fixed generic message. Every output is capped at 300 characters.

The sanitizer never reads raw Error.message, Graph responses, request URLs, headers, tokens, OAuth codes or PINs. Tests cover malicious/raw inputs, prototype-like keys, invalid numeric codes, oversized values, preserved PIN recovery instructions and safe persisted messages from both connect and disconnect. Existing HTTP error codes/statuses remain unchanged.

### Translated settings card

All card UI messages, confirmation text, status labels and actions use `useTranslations('Settings.whatsappConnections')`. Catalogues are provided for all four existing locales: English, Spanish, Portuguese and Korean. Connected, pending and error rows are visible; pending/error rows have Retry and Disconnect actions. Admin restrictions and existing light/dark design tokens are retained. Unit tests render these rows in every locale, check catalogue completeness and verify disabled/admin-only actions without a browser.

## Existing WHATSAPP_EMBEDDED_SIGNUP scaffolding

The earlier CHAT-07 code is `src/lib/whatsapp/embedded-signup.ts` and `/api/whatsapp/config/embedded-signup`. It uses `WHATSAPP_EMBEDDED_SIGNUP`, supports `META_STUB`, and persists the legacy `whatsapp_config` row. It is separate from the new encrypted per-number `wa_connections` flow.

Its old settings probe, stub-code handler and Connect button were removed in Round 2. Settings has one `EmbeddedSignupCard`. The old API remains compatible when the new flag is off, but its feature predicate is suppressed whenever `WACRM_EMBEDDED_SIGNUP=1`. It cannot compete with the new signup card. Known legacy numbers can still receive through the missing-mapping fallback described above.

## SQL review and rollback

Per the Round 5 instruction, SQL is **not applied yet**, so both review-only drafts were edited in place:

- `supabase/shared-project/wacrm_embedded_signup.sql`
- `supabase/shared-project/rollback_wacrm_embedded_signup.sql`

The main draft keeps `search_path = ''`, resolves OUT-column ambiguity using `#variable_conflict use_column`, rejects roles with `current_setting('role', true) IS DISTINCT FROM 'service_role'`, and drops the metadata-read policy if it exists before recreating it. All objects are under `wacrm`; encrypted fields remain service-role-only. No `public` schema object is changed.

The service-only OUT columns are `claimed_pin_ciphertext` and `stored_token_ciphertext`; the latter was renamed in this round to reflect its post-update value. Its **nine input arguments are unchanged**, so the rollback's DROP FUNCTION signature is unchanged; the main draft now drops that exact signature before CREATE OR REPLACE FUNCTION, allowing an older draft OUT shape to be replaced on re-run; the rollback uses the identical signature. No new migration file was added. No SQL, including rollback, was executed.

The table now has a `set_updated_at` BEFORE UPDATE trigger invoking the existing `wacrm.update_updated_at_column()` function. The draft drops/recreates that trigger for re-runs. This keeps updates on the database clock even when the caller does not explicitly set `updated_at`. The rollback's DROP TABLE automatically removes the trigger and does not remove the shared trigger function.

Reference semantics checked against primary documentation: [PostgreSQL UPDATE](https://www.postgresql.org/docs/current/sql-update.html) and [Supabase triggers](https://supabase.com/docs/guides/database/postgres/triggers). The given wacrm trigger function is present in the repository's `wacrm_schema.sql`; no live database check or execution occurred.

### SQL concurrency test plan — review only, NOT executed

Astra Voice must review the draft and Vijay must approve any application. Use an approved disposable database and fabricated account/number/ciphertext data; never use production credentials or phone numbers for this plan.

1. Apply the reviewed draft in that disposable database and create test accounts A and B in `wacrm.accounts`. Record their UUIDs. Use a fresh fabricated PHONE and WABA for each scenario, plus dummy ciphertext values.
2. Session A: begin a transaction, `SET LOCAL ROLE service_role`, and call `wacrm.claim_wa_connection(A_UUID, WABA, PHONE, NULL, NULL, NULL, NULL, DUMMY_TOKEN, DUMMY_PIN)`. Expect one pending row, no ambiguous-column error, and service-only snapshot columns. Keep the transaction open.
3. Session B: begin as service_role and call the function for B_UUID with the same PHONE. Expect it to block on the unique-number conflict until A finishes.
4. Commit A. B must fail with SQLSTATE 23505 / `wa_connection_owned`; roll back B. Verify exactly one row, owned by A, pending, with A's token/PIN. Neither B's failed claim nor any return value may reveal A's ciphertext. Reverse A/B on a fresh PHONE and repeat: exactly one committed claimant wins.
5. Repeat with A rolling back: the waiting B transaction must then succeed. For a same-account connected reconnect, use a synthetic connected row with a known dummy token/PIN. A claim must preserve its connected status, old token, metadata and PIN, and return the retained token/PIN snapshots. This plan does not invoke Meta.
6. **Recovery scenarios (final rule):** mark a fabricated A-owned row disconnected, then claim as B. Expect the same row ID, account_id B, pending status and B's newly supplied PIN ciphertext (not A's old PIN). The returned claimed PIN and stored token must both be B's post-update values. Same-account reconnects must still retain their saved PIN. Reattempt as A while B is fresh pending/connected: expect 23505. Repeat two concurrent B/C claims against an A-owned disconnected row: exactly one wins. Repeat recovery from an **error** row: B is allowed. For a pending A-owned row older than 15 minutes, B is allowed; a fresh pending row rejects B. Check the exact 15-minute boundary in one transaction using its stable `now()` so equality must reject B. Same-account retries remain permitted. Recovery refreshes `updated_at`, preventing immediate takeover by a third account. This replaces the earlier rule that error rows could not transfer.
7. Verify anon/authenticated cannot execute the claim RPC or read token/PIN columns, while metadata reads are RLS-scoped. Check that a missing/null role is denied by the IS DISTINCT FROM guard. Review the rollback's nine-argument identity and perform cleanup only in the approved disposable database.

8. **Trigger behavior:** update a disposable row without assigning `updated_at` and verify the trigger refreshes it. Re-run the draft to check that the trigger is replaced once, not duplicated. Rollback DROP TABLE must remove that trigger while leaving the shared update function intact.
9. **Conditional activation/recovery:** in an approved disposable database, simulate a disconnect after a claim. An account/ID/status-filtered update expecting pending (or connected for an active reconnect) must return zero rows after the row becomes disconnected. It must not modify the disconnected row or its token. The application maps that result to 409 `state_changed`; unit tests exercise both success and Meta-failure recovery races.

Vitest uses a mocked atomic RPC arbiter for race tests. This is not evidence of executed PostgreSQL locking tests. Live Meta operations, SQL execution and database concurrency remain unvalidated here.

## Round 5 validation and SQL hashes

Baseline at c7d0e56 was captured before edits with the same exclusions used afterward. Snapshots and the comparison are committed under `CODE-CHANGES/validation/embedded-signup-round5-*.json`; the accepted original 37-failure manifest at 959899b is retained.

| Check | Before Round 5 | After Round 5 |
| --- | --- | --- |
| Vitest | 1,619 passed / 12 failed / 0 skipped (1,631 total) | 1,636 passed / 12 failed / 0 skipped (1,648 total) |
| Signup, sanitizer, card and webhook tests | 137 passed | **154 passed**, including all 48 webhook route assertions |
| Failing-name diff vs c7d0e56 | 12 names | **0 additions, 0 removals** |
| Retained failure messages | Captured before editing | All 12 exactly unchanged |
| Failing-name diff vs original 959899b list | 37 names | 0 additions, 25 removals |
| `npx tsc --noEmit` | Previously passed | Pass |
| `npx next build` | Previously passed | Pass with dummy values and fresh local build output |

Vitest command: `npx vitest run --exclude '**/brand-lockup-fit.test.ts' --exclude '**/*e2e*' --reporter=json --outputFile=/tmp/wacrm-round5-after.json`.

Build command: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-build-only npx next build`. As in Round 4, the first attempt stopped on the local Turbopack persistence database (`invalid digit found in string`). That `.next` directory was preserved outside the checkout; the identical command with fresh build output then passed without source/configuration changes. Only dummy build values were supplied. No browser/e2e validation was run.

The 12 accepted failures remain untouched: six usage-path assertions and five outbound-path assertions use hard-coded `/workspace/src/...` paths, and one staging Dockerfile assertion lacks existing public Meta ARG/ENV declarations. The usage-path assertion naming the webhook route still fails identically to the accepted baseline; there are no failures in the webhook route tests.

SHA-256 of the updated, unapplied SQL drafts:

| File | SHA-256 |
| --- | --- |
| `supabase/shared-project/wacrm_embedded_signup.sql` | `80dfcdce2f386e4068666a2b8db7cd44a144a322a095e8684c99e6a83eefbe8e` |
| `supabase/shared-project/rollback_wacrm_embedded_signup.sql` | `8a8d8734fdba5ae5173eb13a8ce60c62c16825b8fbaf93655e095a7125c3b709` |

Files changed in Round 5:

- `CODE-CHANGES/embedded-signup.md`
- `CODE-CHANGES/validation/embedded-signup-round5-before.json` (new)
- `CODE-CHANGES/validation/embedded-signup-round5-after.json` (new)
- `src/lib/whatsapp/embedded-signup/core.ts`
- `src/lib/whatsapp/embedded-signup/connect.test.ts`
- `src/lib/whatsapp/embedded-signup/errors.ts` (new)
- `src/lib/whatsapp/embedded-signup/errors.test.ts` (new)
- `src/app/api/whatsapp/embedded-signup/connections/[id]/disconnect/route.ts`
- `src/app/api/whatsapp/embedded-signup/routes.test.ts`
- `supabase/shared-project/wacrm_embedded_signup.sql`
- `supabase/shared-project/rollback_wacrm_embedded_signup.sql`

Only the task branch is eligible for publication. No merge, deploy, SQL application, live SQL queries, server environment change, real credentials, real sends, paid service calls, force push or branch deletion occurred. The published tree must match the validated tree exactly. SQL/Meta integration and live database races remain unexecuted; the test plan is for the separate SQL review/approval process. No upstream implementation code was ported in this round.

## Phase 3, part A

- The existing mandatory signature gate now also protects `account_update` partner events, dispatched before message routing and only with `WACRM_EMBEDDED_SIGNUP=1`. `PARTNER_ADDED`/`PARTNER_REMOVED` change matching `wa_connections` rows to connected/disconnected. The handler reads optional `value.waba_info.waba_id` / `owner_business_id`, with `entry.id` as the WABA fallback. Business-only matching is supported when no WABA is provided; a supplied unknown WABA never changes another WABA in the same business. Unknown mappings log a constant diagnostic and acknowledge 200. This does not create connections, fetch tokens, or provision numbers.
- No event-time column exists. Updates require a valid Unix-seconds `entry.time` newer than `updated_at`, plus matching row ID, status and the observed timestamp at write time. Duplicate/stale event times skip writes. A newer event with the same status uses a safe no-op status update to advance the timestamp guard, so a delayed opposite event cannot reverse it. The existing trigger advances `updated_at` to DB receipt time, conservatively rejecting older events and concurrent changes. Limitation: a delayed event newer than the preceding event but older than its receipt time is also ignored; equal timestamps are ignored. Exact event ordering would require a separately approved schema addition. Missing/invalid event times fail closed. Existing SQL files are unchanged.
- `WACRM_ES_STATE_SECRET` is the dedicated server-only callback-state HMAC key. An unset/empty value falls back to the first `META_APP_SECRET` and warns once per process. Both config issuance and completion verification use the same selector; configuring a dedicated key invalidates outstanding legacy-key cookies. Placeholder examples and staging runtime environment wiring are included; no Docker build argument or public variable was added.
- A request-time settings layout passes the existing server feature flag through a client provider. The card skips `/connections` entirely when disabled, including account changes. Enabled cards retain their existing fetch and API-side flag checks.
- Vitest coverage includes partner transitions, duplicate/stale/racing events, unknown mappings, missing fields, DB failures, actual unsigned/bad-HMAC route rejection without DB access, dedicated-key config/completion, fallback/warning behavior, and both client flag values. No live Meta documentation retrieval or external service calls were made under this task's no-network restriction; the supplied payload contract and existing local hosted-signup notes were used.

Validation (operator, outside the Codex sandbox, CI dummy env): `npx tsc --noEmit` passes; full `npx vitest run` 190 files / 1,781 tests passed, 0 failed; `npm run build` passes. Known-failures list remains empty. No SQL application, external services or deploys.

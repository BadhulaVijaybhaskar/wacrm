# WhatsApp Embedded Signup — Phase 1, Round 3

Task branch: `feat/wa-embedded-signup`. Round 3 base: `a09128dff5437e3ae7cc454473b3ae36c69837b5`.

This document describes the current implementation and supersedes the Round 2 behavior notes. Historical validation manifests remain in `CODE-CHANGES/validation/`.

## Configuration and scope

`WACRM_EMBEDDED_SIGNUP=1` enables the new endpoints and card; default off means hidden UI and 404 responses from all three endpoints. Configuration names are `META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`, `META_GRAPH_VERSION` (default `v23.0`), `NEXT_PUBLIC_META_GRAPH_VERSION`, and `WACRM_TOKEN_ENC_KEY` (base64-encoded 32-byte key). Real values must never enter source control or logs.

Meta setup requires Facebook Login for Business with the Embedded Signup configuration ID, the appropriate domains/OAuth configuration, permissions, App Review and webhook subscriptions. This task does not change a live Meta app or server environment. Sending/templates, token-health/reconnect monitoring, AI replies and CRM/billing remain later-phase work.

## Round 3 changes

### A. Reconnect without disrupting a connected number

- The ownership pre-check reads `account_id,status,pin_ciphertext`. A retained PIN is decrypted and reused; a new six-digit PIN is generated only when none exists. The same retained PIN is used when claiming a disconnected number from another account.
- The atomic SQL claim retains the existing PIN using `COALESCE(c.pin_ciphertext, EXCLUDED.pin_ciphertext)`. Its service-only return includes `claimed_pin_ciphertext`, so registration uses the actual PIN retained by the winning claim even if the pre-check snapshot was stale.
- A connected row keeps its live token, connected status and metadata during register/subscribe. New rows and non-connected claims become pending. The new token/metadata become active only after both Meta operations succeed.
- The claim also returns `previous_token_ciphertext`. A failed connected reconnect restores that token and the connected status rather than marking the live connection error. Other claimed rows become error. Failure to record/restore state cannot mask the original Meta error: the recovery update has its own catch. No ciphertext snapshot is included in the HTTP response.
- Meta error **133005**, specifically from `/register`, becomes HTTP 409 with `code: 'pin_mismatch'`, a matching `error` field, and instructions to turn off two-step verification for the number in WhatsApp Manager before retrying. The card renders localized recovery instructions. Other Graph failures remain failures; unrelated endpoints returning this code are not reclassified as a register PIN mismatch.

The exact PIN code was verified on 30 October 2026 by directly retrieving Meta's official Cloud API error reference, which identifies 133005 as an incorrect two-step verification PIN. No subcode/message guess is used:

- https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration

A generic “already registered” error still is not treated as success: no benign code/subcode contract has been verified. PIN reuse addresses reconnects without inventing such an exception or automatically deregistering a number.

### B. Transfer only disconnected numbers

The application pre-check and atomic SQL predicate both permit another account to claim a row **only when it is disconnected**. SQL updates `account_id = EXCLUDED.account_id`; the winning transfer becomes pending, so another account cannot steal its in-progress claim. Connected/error/pending numbers remain protected against a different account. Tests cover successful transfer, active ownership rejection and concurrent transfer claims with exactly one winner.

### C. Keep shared WABA subscriptions alive

Disconnect checks for another connected or pending row with the same `waba_id`, excluding the target row. This service-side check includes all accounts sharing that WABA. If a sibling exists, only the target row is marked disconnected; no Meta DELETE occurs. A sibling lookup error fails closed with 500 and performs no unsubscribe. Without siblings, a failed unsubscribe returns 502 and marks error; a successful unsubscribe marks disconnected.

Disconnect and connection-list authentication errors preserve their typed status (401 remains 401, 403 remains 403). Database errors remain 500. Metadata listing never exposes token/PIN ciphertext.

### D. Distinguish missing and inactive webhook mappings

`resolveEmbeddedWebhookConnection()` returns distinct `not_found` and `not_connected` results. With the flag enabled:

- A connected mapping resolves its account owner via `wacrm.profiles.account_role` and decrypts its token server-side.
- Only `not_found` can fall back to the legacy `whatsapp_config` lookup. A missing legacy configuration is also dropped. Legacy fallback preserves account, owner and inbound-media settings, and status updates use that resolved account.
- Existing pending/disconnected/error mappings, lookup errors, ambiguous mappings, missing owners and corrupt tokens fail closed; they cannot use a stale legacy token.

The per-IP rate limiter is restored **before** body reading and mandatory HMAC verification. Rate-limited requests do not read the body or run HMAC. Allowed requests must still pass `x-hub-signature-256` verification before parsing/processing. Flag-off legacy behavior remains covered by the original webhook tests. Status updates are scoped through the resolved account's conversations/broadcasts because Meta message IDs can repeat across numbers.

### Translated settings card

All card UI messages, confirmation text, status labels and actions use `useTranslations('Settings.whatsappConnections')`. Catalogues are provided for all four existing locales: English, Spanish, Portuguese and Korean. Connected, pending and error rows are visible; pending/error rows have Retry and Disconnect actions. Admin restrictions and existing light/dark design tokens are retained. Unit tests render these rows in every locale, check catalogue completeness and verify disabled/admin-only actions without a browser.

## Existing WHATSAPP_EMBEDDED_SIGNUP scaffolding

The earlier CHAT-07 code is `src/lib/whatsapp/embedded-signup.ts` and `/api/whatsapp/config/embedded-signup`. It uses `WHATSAPP_EMBEDDED_SIGNUP`, supports `META_STUB`, and persists the legacy `whatsapp_config` row. It is separate from the new encrypted per-number `wa_connections` flow.

Its old settings probe, stub-code handler and Connect button were removed in Round 2. Settings has one `EmbeddedSignupCard`. The old API remains compatible when the new flag is off, but its feature predicate is suppressed whenever `WACRM_EMBEDDED_SIGNUP=1`. It cannot compete with the new signup card. Known legacy numbers can still receive through the missing-mapping fallback described above.

## SQL review and rollback

Per the Round 3 instruction, SQL is **not applied yet**, so both review-only drafts were edited in place:

- `supabase/shared-project/wacrm_embedded_signup.sql`
- `supabase/shared-project/rollback_wacrm_embedded_signup.sql`

The main draft keeps `search_path = ''`, resolves OUT-column ambiguity using `#variable_conflict use_column`, rejects roles with `current_setting('role', true) IS DISTINCT FROM 'service_role'`, and drops the metadata-read policy if it exists before recreating it. All objects are under `wacrm`; encrypted fields remain service-role-only. No `public` schema object is changed.

The claim RPC gains two service-only OUT ciphertext snapshot columns. Its **nine input arguments are unchanged**, so the rollback's DROP FUNCTION signature is unchanged; the rollback now documents why it still matches. No new migration file was added. No SQL, including rollback, was executed.

### SQL concurrency test plan — review only, NOT executed

Astra Voice must review the draft and Vijay must approve any application. Use an approved disposable database and fabricated account/number/ciphertext data; never use production credentials or phone numbers for this plan.

1. Apply the reviewed draft in that disposable database and create test accounts A and B in `wacrm.accounts`. Record their UUIDs. Use a fresh fabricated PHONE and WABA for each scenario, plus dummy ciphertext values.
2. Session A: begin a transaction, `SET LOCAL ROLE service_role`, and call `wacrm.claim_wa_connection(A_UUID, WABA, PHONE, NULL, NULL, NULL, NULL, DUMMY_TOKEN, DUMMY_PIN)`. Expect one pending row, no ambiguous-column error, and service-only snapshot columns. Keep the transaction open.
3. Session B: begin as service_role and call the function for B_UUID with the same PHONE. Expect it to block on the unique-number conflict until A finishes.
4. Commit A. B must fail with SQLSTATE 23505 / `wa_connection_owned`; roll back B. Verify exactly one row, owned by A, pending, with A's token/PIN. Reverse A/B on a fresh PHONE and repeat: exactly one committed claimant wins.
5. Repeat with A rolling back: the waiting B transaction must then succeed. For a same-account connected reconnect, use a synthetic connected row with a known dummy token/PIN. A claim must preserve its connected status, old token, metadata and PIN, and return the retained token/PIN snapshots. This plan does not invoke Meta.
6. **Disconnected-transfer scenario:** mark a fabricated A-owned row disconnected, then claim as B. Expect the same row ID, account_id B, pending status and the retained PIN. Reattempt as A while B is pending/connected: expect 23505. Repeat two concurrent B/C claims against an A-owned disconnected row: exactly one wins. An error row, unlike a disconnected row, must still reject a different account. Reclaiming an error row by its current owner is allowed. This replaces the old test-plan assertion that disconnection never releases ownership.
7. Verify anon/authenticated cannot execute the claim RPC or read token/PIN columns, while metadata reads are RLS-scoped. Check that a missing/null role is denied by the IS DISTINCT FROM guard. Review the rollback's nine-argument identity and perform cleanup only in the approved disposable database.

Vitest uses a mocked atomic RPC arbiter for race tests. This is not evidence of executed PostgreSQL locking tests. Live Meta operations, SQL execution and database concurrency remain unvalidated here.

## Round 3 validation

Baseline at a09128d was captured before edits using the same browser/e2e exclusions as after-validation. Both snapshots and the failing-name comparison are committed under `CODE-CHANGES/validation/embedded-signup-round3-*.json`. The original accepted list of 37 failures at 959899b is also retained.

| Check | Before Round 3 | After Round 3 |
| --- | --- | --- |
| Vitest | 1,575 passed / 12 failed / 0 skipped (1,587 total) | 1,602 passed / 12 failed / 0 skipped (1,614 total) |
| Signup, card and webhook tests | 93 passed | **120 passed**, including all 47 webhook route assertions |
| Failing-name diff vs a09128d | 12 names | **0 additions, 0 removals** |
| Retained failure messages | Captured before editing | All 12 exactly unchanged |
| Failing-name diff vs original 959899b list | 37 names | 0 additions, 25 removals |
| `npx tsc --noEmit` | Previously passed | Pass |
| `npx next build` | Previously passed | Pass with dummy values |

Vitest command: `npx vitest run --exclude '**/brand-lockup-fit.test.ts' --exclude '**/*e2e*' --reporter=json --outputFile=/tmp/wacrm-round3-after.json`.

Build command: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-build-only npx next build`. These are dummy build-only values, not credentials. Existing middleware deprecation warnings remain. No Chromium, Playwright or e2e validation was run.

The 12 accepted failures remain untouched: six usage-path assertions and five outbound-path assertions use hard-coded `/workspace/src/...` paths, and one staging Dockerfile assertion lacks existing public Meta ARG/ENV declarations. The usage-path assertion naming the webhook route still fails identically to the accepted baseline; there are no failures in the webhook route tests.

Files changed in Round 3:

- `CODE-CHANGES/embedded-signup.md`
- `CODE-CHANGES/validation/embedded-signup-round3-before.json` (new)
- `CODE-CHANGES/validation/embedded-signup-round3-after.json` (new)
- `messages/en.json`
- `messages/es.json`
- `messages/pt.json`
- `messages/ko.json`
- `src/lib/whatsapp/embedded-signup/core.ts`
- `src/lib/whatsapp/embedded-signup/connect.test.ts`
- `src/lib/whatsapp/embedded-signup/webhook-routing.ts`
- `src/app/api/whatsapp/embedded-signup/connections/route.ts`
- `src/app/api/whatsapp/embedded-signup/connections/[id]/disconnect/route.ts`
- `src/app/api/whatsapp/embedded-signup/routes.test.ts`
- `src/app/api/whatsapp/webhook/route.ts`
- `src/app/api/whatsapp/webhook/route.test.ts`
- `src/components/settings/embedded-signup-card.tsx`
- `src/components/settings/embedded-signup-card.test.ts` (new)
- `supabase/shared-project/wacrm_embedded_signup.sql`
- `supabase/shared-project/rollback_wacrm_embedded_signup.sql`

Only the task branch is eligible for publication. No merge, deploy, SQL application, server environment change, real credentials, real sends, paid service calls, force push or branch deletion occurred. The published tree must match the locally validated tree exactly. No upstream implementation code was ported in this round.

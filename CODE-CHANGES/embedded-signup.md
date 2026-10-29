# WhatsApp Embedded Signup (review before enabling)

Base: `deploy/wa-golive2-after-call-invite`. Flag `WACRM_EMBEDDED_SIGNUP=1` enables new endpoints; default is off (404). The old `WHATSAPP_EMBEDDED_SIGNUP` scaffolding is suppressed when this flag is on; its stub Connect button has been removed from settings.

## Environment
Set `META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`, `META_GRAPH_VERSION` (defaults `v23.0`), and `WACRM_TOKEN_ENC_KEY` (base64 of 32 secure random bytes, generate using `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Never put real secrets in source control.

## Meta developer dashboard
Configure Facebook Login for Business with the WhatsApp Embedded Signup configuration ID. Set Allowed Domains, app domain, and OAuth redirect `https://wa.astraconnect.io` as required by Meta, and verify Graph permissions, app review, and webhook subscriptions.

## Database review / rollback
Review `supabase/shared-project/wacrm_embedded_signup.sql` against the live `wacrm.accounts` table and role grants. Apply only in a controlled maintenance process. To undo, review and manually run `supabase/shared-project/rollback_wacrm_embedded_signup.sql` (destructive: permanently deletes connection rows).

## Security
Service role claims numbers atomically. Authenticated members only read non-secret columns. Never expose OAuth codes, tokens, registration PINs, or Meta raw error details. Encryption key rotation requires planned re-encryption.

## Phase 1 validation fixes (base 959899b)

- `connect()` exchanges the code and verifies the WABA/number, pre-checks existing ownership, then atomically claims a **pending** row. Only the winning account can register/subscribe. Successful provisioning changes it to `connected`; failures after claim write `error` and a safe code. The response uses an explicit public-field allowlist. Transport exceptions and unsuccessful Graph mutations are sanitized.
- Complete preserves typed authentication and SignupError statuses, including 400/403/409/502. Disconnect separates authentication, ownership/not-found, database and Meta failures; failed unsubscribe writes `error` and returns 502. Error/pending rows can retry disconnect.
- Mandatory HMAC verification is the first POST gate. Flag-on messaging resolves `metadata.phone_number_id` only in `wacrm.wa_connections`; unknown, pending, disconnected, error, ambiguous and corrupt-token rows do not fall back to legacy config. Owner lookup explicitly uses `wacrm.profiles.account_role`, which exists in `supabase/shared-project/wacrm_schema.sql` and is used by `src/lib/auth/account.ts`. The shared routing type includes all fields consumed by message processing. Status updates and fan-out are scoped through the owning account's conversations/broadcasts because Meta message IDs may repeat across numbers. Flag-off legacy routing is preserved.
- The review-only `wacrm_embedded_signup.sql` draft accepts/defaults/claims `pending` and uses `#variable_conflict use_column` to resolve PL/pgSQL OUT-column ambiguity. `search_path = ''` and the function's nine-argument signature are unchanged. The existing `rollback_wacrm_embedded_signup.sql` still matches; no rollback change is required. No SQL was applied and no new migration file was added.

### Registration error verification — limitation, not a guessed exception

On 29 October 2026, the official Meta registration, provider-registration, Cloud API error-code and Embedded Signup error references were retrieved directly. They do **not** identify a benign `/register` error-code/subcode pair that can safely be treated as success. The Embedded Signup reference lists `3441030` and `3441049` as already-registered situations requiring a different number, deregistration or disconnection; these are not documented successful `/register` responses. `136024` was not verified as a benign registration error.

Accordingly, the unused `alreadyRegistered()` helper and the unsafe `136024` bypass were removed. All failed `/register` responses currently return 502 and mark the claimed row `error`. **The requested already-registered-error tolerance and its positive unit test remain unimplemented pending an authoritative benign code/subcode contract.** Tests cover rejection of generic 100, the old 136024 exception, PIN and rate-limit failures. A successful registration requires `success: true`. No numeric error/subcode was invented, and no number is automatically deregistered.

Primary references (no upstream implementation code was ported in these fixes):

- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration
- https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/registering-phone-numbers
- https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/errors

### Existing WHATSAPP_EMBEDDED_SIGNUP scaffolding

The earlier CHAT-07 code is `src/lib/whatsapp/embedded-signup.ts`, its `/api/whatsapp/config/embedded-signup` endpoint, and the old settings probe/handler/button. It uses `WHATSAPP_EMBEDDED_SIGNUP`, supports `META_STUB`, and persists the legacy `whatsapp_config` row; it is distinct from Phase 1's encrypted per-number `wa_connections` flow.

The legacy settings probe, stub-code handler and button have been removed. Settings contains exactly one `EmbeddedSignupCard`; it stays hidden when the Phase 1 endpoints return 404. The older API is retained for compatibility when the new flag is off, but its feature predicate is disabled whenever `WACRM_EMBEDDED_SIGNUP=1`. It cannot compete with the new flow. No new visual style or product/code renames were introduced.

### SQL concurrency test plan — review only; NOT executed

Astra Voice must review the SQL and Vijay must approve application. The following is a plan for an approved disposable database containing only test accounts; it must not be executed against the shared project by this task.

1. Apply the reviewed draft in the disposable database. Create two disposable accounts A and B in `wacrm.accounts` and record their UUIDs. Use fabricated, unique phone/WABA strings and dummy ciphertext values, never a real token/PIN.
2. In session A: `BEGIN; SET LOCAL ROLE service_role;` then call `wacrm.claim_wa_connection(A_UUID, WABA, PHONE, NULL, NULL, NULL, NULL, DUMMY_TOKEN_CIPHERTEXT, DUMMY_PIN_CIPHERTEXT)`. Expect one row with `status = 'pending'`, no ambiguous-column error. Keep the transaction open.
3. In session B: begin a transaction as `service_role` and call the same function with B_UUID and the **same** PHONE. Expect it to block on the unique-number conflict until A commits.
4. Commit A. Expect B to fail with SQLSTATE `23505` / `wa_connection_owned`; roll back B. A service-role read must show exactly one row, owned by A, still pending. B must not overwrite A's token/PIN/metadata. No Graph endpoint is called by SQL.
5. Repeat with a fresh fabricated PHONE, reversing A/B: exactly the first committed claimant wins. Also repeat with the first transaction **rolling back**: the waiting second transaction must then succeed with one pending row.
6. Reclaim the winning account's row: it remains the same ID, becomes pending and clears `last_error`. Claim it from the other account after marking it error or disconnected: it must still fail 23505. Neither state releases number ownership.
7. Verify non-service-role RPC execution is denied, member metadata visibility is RLS-scoped, and token/PIN column access is denied to anon/authenticated. Review the existing rollback's exact nine-argument signature; execute cleanup only inside the approved disposable environment.

The concurrent-account vitest uses a mocked atomic RPC arbiter and checks exactly one fulfilled connection and one 409, with one register and one subscribe. It is **not** evidence that SQL was executed or database locking was integration-tested.

### Validation report

Baseline was captured **before edits** at `959899bd84892466373552b1fde6dc17ab24e945` using `npx vitest run --reporter=json --outputFile=/tmp/wacrm-baseline.json`. The committed baseline manifest preserves all 37 failing assertion names. The full raw JSON and failure messages were kept locally for comparison.

| Check | Before | After |
| --- | --- | --- |
| Vitest assertions | 1,505 passed / 37 failed / 6 skipped (1,548 total) | 1,575 passed / 12 failed / 0 skipped (1,587 total) |
| Embedded-signup and webhook route assertions | Existing baseline | All 93 pass, including all 43 webhook route assertions |
| Failing-test name diff | 37 names | **0 additions, 25 removals, 12 retained** |
| Retained failure messages | Baseline captured | All 12 exactly identical to baseline JSON |
| `npx tsc --noEmit` | Pass | Pass |
| `npx next build` | Pass with dummy Supabase values | Pass with the same dummy values |

After command: `npx vitest run --exclude '**/brand-lockup-fit.test.ts' --exclude '**/*e2e*' --reporter=json --outputFile=/tmp/wacrm-after.json`. Per the revised validation rule, the six Playwright visual assertions and two e2e assertions were excluded; 47 assertions were added. Counts therefore use explicitly different selection sets. No browser/e2e test was run for after-validation, and no browser installation was attempted in this continuation.

Build command: `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-build-only npx next build`. No service credential or real environment value was supplied. Existing middleware-deprecation warnings remain.

The remaining 12 failures are deliberately untouched: six usage-path assertions and five outbound-path assertions read hard-coded `/workspace/src/...` paths; one staging Dockerfile assertion lacks the existing public Meta ARG/ENV declarations. The usage-path assertion naming `webhook/route.ts` fails **identically at 959899b** (missing hard-coded file path). There are **no failures in `webhook/route.test.ts`**: its 25 baseline failing assertions now pass after its service-client boundary mock was updated. Baseline and after manifests, including the full removal list, are under `CODE-CHANGES/validation/`.

Files changed:

- `CODE-CHANGES/embedded-signup.md`
- `CODE-CHANGES/validation/embedded-signup-baseline.json` (new)
- `CODE-CHANGES/validation/embedded-signup-after.json` (new)
- `src/lib/whatsapp/embedded-signup/core.ts`
- `src/lib/whatsapp/embedded-signup/connect.test.ts` (new)
- `src/lib/whatsapp/embedded-signup/webhook-routing.ts` (new)
- `src/lib/whatsapp/embedded-signup.ts`
- `src/lib/whatsapp/embedded-signup.test.ts`
- `src/app/api/whatsapp/embedded-signup/complete/route.ts`
- `src/app/api/whatsapp/embedded-signup/connections/[id]/disconnect/route.ts`
- `src/app/api/whatsapp/embedded-signup/routes.test.ts` (new)
- `src/app/api/whatsapp/webhook/route.ts`
- `src/app/api/whatsapp/webhook/route.test.ts`
- `src/components/settings/whatsapp-config.tsx`
- `src/components/settings/embedded-signup-wiring.test.ts` (new)
- `supabase/shared-project/wacrm_embedded_signup.sql`

Only the task branch is eligible for push. No merge, deploy, server environment change, SQL execution, real credentials, real sends or paid service calls were performed. Live Meta onboarding/App Review and approved SQL execution remain unvalidated. Phase 1 must not be called fully complete while the registration-tolerance contract remains unverified.

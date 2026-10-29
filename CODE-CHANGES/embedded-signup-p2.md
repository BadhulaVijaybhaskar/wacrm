# Embedded Signup Phase 2

Base: `2e9a460292208fcd07ca8c18a6d3d2968a46114d`; branch: `feat/wa-embedded-signup`.

## Changes

The existing card defaults to Business app coexistence and offers standard/API-only onboarding. Both use one config ID, v4 extras and Graph v26.0 defaults. FB.init gets server META_GRAPH_VERSION from the authenticated config endpoint. Strings use t() in en/es/ko/pt; existing components/styles are reused. Mode is sent to completion and logged as an allowlisted enum, without new SQL.

Coexistence verifies is_on_biz_app/platform_type, skips registration/PIN, subscribes the WABA, and requests contacts then history through smb_app_data. Standard registration retains ownership/legacy checks, atomic claim, encryption and CAS behavior. Missing IDs are discovered through debug_token granular scopes and phone_numbers; ambiguity fails closed.

The settings callback strips code/state/asset parameters before submitting once to the existing completion/core path. Admin authorization and an account-bound signed state cookie are mandatory for URL callbacks (HTTP-only, secure, ten-minute lifetime).

## Meta hosted-link discrepancy and remaining limits

**Meta's current Hosted Embedded Signup guide does not document the proposed ?code= landing-page redirect.** It documents account_update/PARTNER_ADDED and generating a business token using a provider system-user token. This change implements a secure OAuth-code callback, not that distinct hosted webhook/token-generation flow. An initiator must obtain the nonce from the authenticated config endpoint and have its provider echo state. An arbitrary unbound hosted redirect is rejected. A true Meta hosted-link provisioning flow still needs a defined provider-token/account-mapping contract; no unsupported URL contract was assumed.

Meta requires dashboard subscriptions to history, smb_app_state_sync and smb_message_echoes. No app/server configuration was changed. The webhook ingests contacts, text/history placeholders and app echoes without historical billing, unread effects or bots. Historical-media hydration and a synchronization-progress UI are not implemented. Address-book removal does not delete CRM records.

Contacts/history requests are one-time and must start within 24 hours. They are not replayed for same-account token reconnects. There is no new durable per-step sync journal: partial initial sync or an expired window may require Meta's documented offboard/onboard recovery. History writes use existing webhook processing and batches of 200, without new workers. Live provider configuration and end-to-end onboarding were not exercised with real credentials.

## Sending and health

getSendCredentials scopes all token reads by account_id and optionally phone_number_id. Connected ES rows supply credentials; absent ES data falls back to the original account-scoped legacy config. Known inactive ES numbers fail closed, foreign rows are rejected before decrypting, and ambiguous numbers require selection. A transient encryption adapter preserves existing sender interfaces without persisting legacy-format ES tokens.

Inbound/sent messages retain source-phone provenance in existing interactive_payload JSON. Inbox/quoted replies, AI typing/replies, automations, flows, reactions, broadcasts/resume, templates, media and after-call templates use the resolver. The shared messages POST rechecks account/number credentials immediately before sending. Existing channel gating, tenant checks and durable after-call idempotency remain. Old conversations without provenance use only an unambiguous connected number.

Legacy adapter tenant/employee configuration, provisioning and config editing remain legacy configuration concerns. The old WHATSAPP_EMBEDDED_SIGNUP scaffold remains the manual/legacy path, hidden by feature selection so only one Connect entry is shown.

An admin-only flag-gated health route inspects connected tokens with server-only app credentials. Invalid/expired/wrong-app/missing-scope tokens become error with sanitized last_error. Content-send Meta 190 does the same, guarded against invalidating a newly rotated token. The card offers Check connection and Reconnect WhatsApp. Checks reuse the authenticated automation cron with an oldest-first bounded scan; no infrastructure was added. Transient introspection failures do not invalidate tokens. No token/PIN/code is returned or intentionally logged.

## Validation

- Before: 1,636 passed / 12 failed / 1,648 total.
- After: 1,689 passed / 12 failed / 1,707 total: 59 added tests.
- Focused core/routes/credentials/webhook: 182 passed across nine files.
- New failing names: []; removed failing names: []; failure-message changes: [].
- Original accepted 37-failure baseline: zero new names, 25 retained removals.
- Webhook and after-call behavior tests pass. The remaining webhook source-wiring assertion is the identical baseline hard-coded /workspace/src read failure, with identical message.
- npx tsc --noEmit: PASS after build generated route types. An earlier concurrent check overlapped generation; the final serial check passes.
- npx next build: PASS with dummy NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co and NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-build-only. Existing middleware deprecation warning. Stale build cache moved outside checkout before building.
- git diff --check: PASS. No Playwright/e2e.

The 12 unchanged failures are 11 hard-coded source-path assertions for usage metering/Connect notification and the existing Docker public Meta ARG/ENV assertion. No unrelated baseline fixes. Full names/comparisons are in validation/embedded-signup-p2-{before,after}.json.

## SQL and restrictions

No new SQL, applied SQL edits, or SQL execution. Unchanged SHA-256:

- wacrm_embedded_signup.sql: 80dfcdce2f386e4068666a2b8db7cd44a144a322a095e8684c99e6a83eefbe8e
- rollback_wacrm_embedded_signup.sql: 8a8d8734fdba5ae5173eb13a8ce60c62c16825b8fbaf93655e095a7125c3b709

No merge, deploy, server-env changes, real credentials or sends.

## Meta references

- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/hosted-es
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging-and-error-handling/

The coexistence guide documents skip-register, phone status fields, initial sync requests and webhooks. The hosted guide is cited to explain the redirect discrepancy, not to assert that it guarantees OAuth query parameters.

## Files changed

- `.env.example`
- `CODE-CHANGES/embedded-signup-p2.md`
- `CODE-CHANGES/validation/embedded-signup-p2-after.json`
- `CODE-CHANGES/validation/embedded-signup-p2-before.json`
- `messages/en.json`
- `messages/es.json`
- `messages/ko.json`
- `messages/pt.json`
- `src/app/(dashboard)/inbox/page.tsx`
- `src/app/(dashboard)/settings/page.tsx`
- `src/app/api/automations/cron/route.ts`
- `src/app/api/whatsapp/broadcast/route.ts`
- `src/app/api/whatsapp/embedded-signup/complete/route.ts`
- `src/app/api/whatsapp/embedded-signup/config/route.ts`
- `src/app/api/whatsapp/embedded-signup/health/route.ts`
- `src/app/api/whatsapp/embedded-signup/routes.test.ts`
- `src/app/api/whatsapp/media/[mediaId]/route.ts`
- `src/app/api/whatsapp/react/route.ts`
- `src/app/api/whatsapp/templates/[id]/route.ts`
- `src/app/api/whatsapp/templates/submit/route.ts`
- `src/app/api/whatsapp/templates/sync/route.ts`
- `src/app/api/whatsapp/webhook/route.test.ts`
- `src/app/api/whatsapp/webhook/route.ts`
- `src/components/settings/embedded-signup-callback.tsx`
- `src/components/settings/embedded-signup-card.test.ts`
- `src/components/settings/embedded-signup-card.tsx`
- `src/lib/ai/auto-reply.ts`
- `src/lib/astra-connect/after-call-templates.ts`
- `src/lib/auth/account.ts`
- `src/lib/automations/meta-send.ts`
- `src/lib/flows/meta-send.ts`
- `src/lib/whatsapp/broadcast-core.ts`
- `src/lib/whatsapp/broadcast-resume.ts`
- `src/lib/whatsapp/embedded-signup/callback-state.test.ts`
- `src/lib/whatsapp/embedded-signup/callback-state.ts`
- `src/lib/whatsapp/embedded-signup/coexistence.test.ts`
- `src/lib/whatsapp/embedded-signup/coexistence.ts`
- `src/lib/whatsapp/embedded-signup/connect.test.ts`
- `src/lib/whatsapp/embedded-signup/core.ts`
- `src/lib/whatsapp/embedded-signup/errors.ts`
- `src/lib/whatsapp/embedded-signup/health.ts`
- `src/lib/whatsapp/embedded-signup/launch.test.ts`
- `src/lib/whatsapp/embedded-signup/launch.ts`
- `src/lib/whatsapp/embedded-signup/webhook-routing.ts`
- `src/lib/whatsapp/meta-api.ts`
- `src/lib/whatsapp/meta-api.typing.test.ts`
- `src/lib/whatsapp/resolve-conversation.ts`
- `src/lib/whatsapp/send-credentials.test.ts`
- `src/lib/whatsapp/send-credentials.ts`
- `src/lib/whatsapp/send-message.ts`

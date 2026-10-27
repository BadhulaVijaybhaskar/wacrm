# Security review — 2026-10 (CHAT-12)

Audit of Astra Chat API auth, tenant isolation, webhooks, rate limits, and XSS. Staging DB only; no production changes.

## Findings and fixes

### 1. API authentication

| Area | Finding | Fix |
| --- | --- | --- |
| Middleware | Only `/api/whatsapp/*` (minus webhook) returned 401 without a session | Expanded to all `/api/*` except documented public prefixes (`/api/v1`, `/api/astra-connect`, webhook, invitations, crons) |
| WhatsApp config POST/DELETE | Membership-only `getUser` allowed agents to mutate Meta credentials | `requireRole('admin')` |
| Template PATCH/DELETE | Same | `requireRole('admin')` |
| Public API `/api/v1` | Already `requireApiKey` + per-key rate limit | Verified |
| Connect read/handoff | HMAC + tenant lookup | Verified (timing-safe + 5 min replay) |
| Route audit | Risk of new routes shipping without a gate | `src/lib/security/route-auth-audit.test.ts` fails CI if a `route.ts` lacks a known auth pattern |

Unauthenticated access tests: `src/middleware.test.ts` (401 on `/api/whatsapp/send`, `/api/contacts/...`; webhook + v1 + Connect allowed).

### 2. Tenant isolation

- Hot paths (`send-message`, automations `meta-send`, broadcast-core, Connect read API, consent ledger) filter by `account_id`.
- Unit guard: `src/lib/security/tenant-isolation.test.ts`.
- Postgres RLS (`is_account_member`) remains the authoritative boundary (migrations 017+). Live RLS probes need staging credentials (agent cannot access `wacrm-staging`).

### 3. Webhook signatures and replay

| Endpoint | Check |
| --- | --- |
| `POST /api/whatsapp/webhook` | HMAC-SHA256 (`x-hub-signature-256`), fail-closed without `META_APP_SECRET`, `timingSafeEqual`, multi-secret support |
| Meta replay window | `isMetaWebhookPayloadFresh` — newest payload `timestamp` must be within 15 minutes |
| Connect adapter / read API | `verifyAstraSignature` — timestamp in signed message, 300s tolerance, timing-safe hex compare |

### 4. Rate limits

| Bucket | Limit | Applied on |
| --- | --- | --- |
| `RATE_LIMITS.auth` | 30/min | Documented for auth-adjacent surfaces; invite peek/redeem already dedicated |
| `RATE_LIMITS.publicApi` | 120/min | `/api/v1` via `requireApiKey` |
| `RATE_LIMITS.webhook` | 120/min | Meta webhook POST (per IP) |
| `RATE_LIMITS.send` | 60/min | Manual `/api/automations/engine` (new) |

### 5. XSS / message rendering

- Inbox `MessageBubble` renders text/captions via React text nodes after control-char strip (`SafeText`) — no `dangerouslySetInnerHTML`.
- Interactive payloads run through `sanitizeInteractivePayload` before preview.
- `escapeHtml` / `sanitizeMessageText` / `sanitizeLinkPreviewUrl` for non-React sinks.
- Tests: `src/lib/security/sanitize-message.test.ts` with `<script>`, `onerror=`, `javascript:` payloads.

### 6. Remaining gaps

- Password login goes client → Supabase Auth (not our `/api`); platform rate limits apply. `RATE_LIMITS.auth` is ready for any future first-party auth proxy.
- Full RLS integration tests require staging DB access (owner-only).
- In-memory rate limiter is single-process (documented in `rate-limit.ts`); multi-instance deploys need Redis.

## Migrations

None in CHAT-12 (consent ledger was CHAT-11 / `047`).

## Tests added / updated

- `src/app/api/whatsapp/config/route.role.test.ts`
- `src/app/api/whatsapp/templates/[id]/route.test.ts`
- `src/app/api/automations/engine/route.test.ts`
- `src/middleware.test.ts` (API gate)
- `src/lib/security/sanitize-message.test.ts`
- `src/lib/security/route-auth-audit.test.ts`
- `src/lib/security/tenant-isolation.test.ts`
- webhook signature freshness helper (+ existing HMAC suite)

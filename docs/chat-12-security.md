# CHAT-12 — Security hardening (shipped)

## Changes

1. **Admin role on Meta side-effect routes**
   - `PATCH`/`DELETE` `/api/whatsapp/templates/[id]` → `requireRole('admin')`
   - `POST`/`DELETE` `/api/whatsapp/config` → `requireRole('admin')`
2. **Rate limit** on `POST /api/automations/engine` (`RATE_LIMITS.send` per user).
3. **Middleware contract tests**: unauth `/api/whatsapp/send` → 401; `/api/whatsapp/webhook` allowed without session.

## Already strong (verified, not rewritten)

- Meta webhook HMAC fail-closed (`webhook-signature.ts`)
- Public API key auth + rate limits (`/api/v1`)
- Connect HMAC + tenant-scoped read/handoff
- Inbox message bodies rendered as React text (no HTML XSS sink)
- Password-reset callback next-path sanitization (CHAT-15)

## Migrations

None.

## Tests

- `src/app/api/whatsapp/templates/[id]/route.test.ts`
- `src/app/api/whatsapp/config/route.role.test.ts`
- `src/app/api/automations/engine/route.test.ts`
- `src/middleware.test.ts` (API gate cases)

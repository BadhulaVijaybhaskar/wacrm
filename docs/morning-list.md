# Morning list — Astra Chat overnight queue

Owner priority (2026-10-27 reset): finish beats breadth. Five shippable items beat twenty half-done.
Each row: **done** needs SHA + tests + screenshot, otherwise **not started**.

Real DB is **wacrm-staging** (owner applies migrations). New migrations must continue from `047_`.

## Status

| Item | Status | SHA | Tests | Screenshot / notes |
| --- | --- | --- | --- | --- |
| CHAT-02b brand + Connect UI kit theme | **done** | `fec6672` | `vitest` 1114 passed; `tsc --noEmit` clean | `artifacts/chat-02b/` |
| Golden rule + CHAT-15 UI control audit | **done** | `3cd1370` | `vitest` 1125 passed; `tsc --noEmit` clean | `docs/ui-control-audit.md`; `artifacts/chat-15/`; password-reset E2E fixed; Auth template create hidden |
| CHAT-12 security hardening | not started | — | — | Auth on every route, tenant isolation, webhook sigs, rate limits, XSS |
| CHAT-04b Connect read/takeover API | **done** | `9222bbe` | covered in suite at land | Migration: `046_astra_connect_read_api.sql` |
| CHAT-05 per-tenant secrets | **done** | `e242732` | suite | Migration: `044_astra_connect_tenant_secret.sql` |
| Staging smoke + seed + CHAT-14 screenshots | not started | — | — | `deploy/staging` smoke + seed script |
| CHAT-03 Settings UI | **done** | `8062658` | suite | — |
| CHAT-09 | not started | — | — | Spec TBD / deferred |
| CHAT-11 | not started | — | — | Spec TBD / deferred |
| CHAT-10 | not started | — | — | Spec TBD / deferred |
| CHAT-08 | not started | — | — | Spec TBD / deferred |
| CHAT-06 usage metering | **done** | `3a28e3e` | suite | Migration: `045_astra_usage_metering.sql` |
| CHAT-07 Embedded Signup | **done** | `34759b9` | suite | Scaffolding only |
| CHAT-04 outbound mirror | **done** (gated off) | `04f6113` + `cf8b43a` | suite | `CONNECT_MIRROR_OUTBOUND` default off |
| CHAT-16…25 integrations | not started | — | — | Last; only if time remains |

## Migrations owner must apply on wacrm-staging

Already on branch (apply if not yet on staging):

- `043_astra_connect_adapter.sql`
- `044_astra_connect_tenant_secret.sql`
- `045_astra_usage_metering.sql`
- `046_astra_connect_read_api.sql`

No new migration in CHAT-02b or CHAT-15.

## Next up

1. CHAT-12 security + expanded tests.
2. Staging smoke readiness + seed + CHAT-14 verification screenshots.
3. Remaining value-ordered CHAT items only if they can ship cleanly; otherwise leave **not started**.

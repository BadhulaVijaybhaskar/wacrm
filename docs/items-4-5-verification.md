# Items 4–5 verification

Branch: `cursor/astra-connect-adapter-f6ad`  
Evidence: prod build (`META_STUB=1`, `INTEGRATIONS_STUB=1`, `WHATSAPP_TEMPLATES_DRY_RUN=1`), signed-in seed `demo@astraconnect.io`.  
Screenshots: `artifacts/item-4/`, `artifacts/item-5/` via `scripts/items-4-5-screenshots.mjs`.

## Full suite

| Runner | Files | Tests |
|--------|------:|------:|
| `npx vitest run` | 148 passed | **1386 passed** |

Re-run tip after code changes: unset stub/`NODE_ENV` leakage before vitest.

## Per sub-item

| Item | Tip SHA (feature commit) | Tests (count) | Key test names | Screenshot |
|------|--------------------------|---------------|----------------|------------|
| **4a** Connect on/off → no inbound forward; read API **403** `connect_disabled` | `18426dc` | **17** | `authenticateConnectRequest … returns 403 when Connect is disabled for the tenant (item 4a)`; `dispatchInboundToAstraConnect no-ops when adapter is not active`; `PATCH … updates enabled + tenant_id` | `artifacts/item-4/4a-astra-connect-switch.png` |
| **4b** Per-customer secret generate / rotate / reveal-once (044) | `203601a` | **7** | `POST …/secret generates a reveal-once secret when none exists`; `… rejects generate when a secret already exists`; `… rotates even when a secret exists`; secrets encrypt / 24h previous | `artifacts/item-4/4b-secret-generate-rotate.png` |
| **4c** Usage daily + Settings view + `BILLING_WEBHOOK_URL` stub (045) | `213ff43` (+ service-read fix below) | **20** | `GET /api/billing/usage returns daily rows + totals`; `emitBillingUsageWebhook is a no-op when URL is unset`; metering wiring on send/webhook/broadcast | `artifacts/item-4/4c-usage-billing.png` |
| **5a** Templates list / create / stub submit / composer | *(pre-existing on branch)* | **12** | stub-decision APPROVED under `META_STUB`; dry-run id helpers; template preview `{{n}}`; role gate on PATCH/DELETE | `artifacts/item-5/5a-templates.png` |
| **5b** Inbox assign / notes / labels / filters / takeover / quick replies / search | *(pre-existing on branch)* | **9** | `matchesAssignmentFilter`; `matchesConversationSearch`; tag/company filters; `normalizeConversation` tags | `artifacts/item-5/5b-inbox-upgrades.png` |
| **5c** Contact CSV import preview / dedupe / errors | *(pre-existing on branch)* | **30** | `validateImportRows`; `dedupeByPhone`; column map; E.164 `normalizeToE164`; `buildImportErrorCsv` | `artifacts/item-5/5c-contacts-csv-import.png` |
| **5d** Opt-out list + STOP + broadcasts skip + consent ledger (047) | `95c1bee` | **14** | `processInboundConsentKeyword applies STOP`; `skipIfOptedOut`; `/api/consent/opt-outs` GET/POST; keyword detect | `artifacts/item-5/5d-consent-opt-out.png` |

Evidence / docs commit SHA is recorded at the bottom after the final push.

### 4c note

`astra_usage_daily` is deny-all RLS (045). `GET /api/billing/usage` authenticates with `requireRole('admin')` then reads via `createServiceClient()`, scoped by `accountId`.

### UI golden-rule checks (Playwright)

`scripts/items-4-5-screenshots.mjs` — 7 PNGs, 0 failures on seed session:

- 4a switch visible under Settings → Astra Connect  
- 4b Generate/Rotate → reveal-once “Copy your secret now”  
- 4c Usage totals + daily row + “Billing webhook not set (stubbed / no-op)”  
- 5a New Message Template dialog (stub submit CTA)  
- 5b Inbox thread: search, filters, assignee, notes, tags, quick-reply control  
- 5c Import Contacts modal (CSV choose + preview copy)  
- 5d Consent list with opted-out contact + Opt back in

Evidence commit: `bdcb314` · 4c service-read fix: `dd9a85d`

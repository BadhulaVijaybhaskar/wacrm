# Morning list — Astra Chat

Running checklist of credentials, OAuth apps, paid plans and env vars that need a **real** account before a connector can go live. Stub/mock mode (`META_STUB=1` or `INTEGRATIONS_STUB=1`) covers tests and local demos.

Real DB is **wacrm-staging** (owner applies migrations). Latest on branch starts at `048_`.

## Live credentials needed

| Integration | What’s needed | Where to get it | Env / setting name |
| --- | --- | --- | --- |
| Shared crypto | 32-byte AES key (64 hex chars) | Generate offline; store in host secrets | `ENCRYPTION_KEY` |
| Meta / WhatsApp | App + WABA + phone | Meta Developer Console | WhatsApp Settings (encrypted tokens); `META_STUB` for fake |
| Astra Connect | Adapter URL + HMAC secret | Astra Connect tenant | `CONNECT_ADAPTER_URL`, `WACRM_ADAPTER_SECRET`; per-account secret in Settings → Astra Connect |
| Outbound webhooks | HTTPS receiver that verifies HMAC | Your automation host | Settings → Integrations → Outbound webhooks / `webhook_endpoints` |
| Zapier | Zapier account + REST Hook app | zapier.com | Settings → Integrations → Zapier (`hook_url`) |
| Make | Make.com scenario webhook | make.com | Settings → Integrations → Make (`hook_url`) |
| Shopify | Custom app + webhook secret | Shopify Partners | Settings → Integrations → Shopify (`shop_domain`, `webhook_secret`, `admin_token`) |
| WooCommerce | REST keys + webhook secret | WP admin → WooCommerce | Settings → Integrations → WooCommerce |
| Razorpay | Key ID/secret + webhook secret | razorpay.com dashboard | Settings → Integrations → Razorpay |
| Stripe | Secret + webhook signing secret | dashboard.stripe.com | Settings → Integrations → Stripe |
| Google Sheets | OAuth client (consent screen) | Google Cloud Console | Settings → Integrations → Google Sheets; cron: `AUTOMATION_CRON_SECRET` |
| HubSpot | Private app token | HubSpot settings | Settings → Integrations → HubSpot |
| Zoho CRM | OAuth client + refresh token | Zoho API console | Settings → Integrations → Zoho |
| Astra CRM | Signed webhook URL | Astra / Frappe CRM | Settings → Integrations → Astra CRM (`webhook_url`, `signing_secret`) |
| Instagram / Messenger | Meta page + tokens | Meta Developer Console | Settings → Integrations → Instagram / Messenger |
| Click-to-WhatsApp ads | Meta Ads account + CTWA ads | Meta Ads Manager | Referral captured automatically on inbound; report at `/ads` |
| Public API | Account API keys | Settings → API keys | Bearer key; scopes in `api_keys` |
| Automation / flow cron | Shared cron secret | Host env | `AUTOMATION_CRON_SECRET` (and flow cron equivalent) |
| Billing usage webhook | Optional signed emitter URL | Your billing service | `BILLING_WEBHOOK_URL` |

## Queue status (CHAT-16+)

| Item | Status | SHA | Migrations | Notes |
| --- | --- | --- | --- | --- |
| CHAT-16 Integrations hub | **done** | `8d0a314` | `048_integrations_hub.sql` | Settings → Integrations; `artifacts/chat-16/` |
| CHAT-17 Outbound webhooks / Zapier / Make | **done** | `2d7e851` | `049_webhook_retry_queue.sql` | Event catalog, REST hooks, retry cron, `/developers/api` |
| CHAT-18 Shopify + WooCommerce | **done** | `2e0337a` | `050_ecommerce_integrations.sql` | Webhooks + notify queue + catalog stub |
| CHAT-19 Razorpay + Stripe | **done** | `7373a1c` | `051_payment_links.sql` | Composer payment link + status webhooks |
| CHAT-20 Google Sheets | **done** | `6518982` | `052_google_sheets_sync.sql` | OAuth scaffold + import/export + cron |
| CHAT-21 CRM push | **done** | `333bb79` | `053_crm_push.sql` | HubSpot/Zoho/Astra CRM push + retry log |
| CHAT-22 IG + Messenger inbox | **done** | `69ed709` | `054_messaging_channels.sql` | Channel field + Meta messaging stub |
| CHAT-23 Flow builder | **done** | `704b63a` | `055_flow_builder_nodes.sql` | Visual nodes + test simulator; `artifacts/chat-23/` |
| CHAT-24 CTWA ads | **done** | `fc07e35` | `056_ctwa_ads_attribution.sql` | Referral capture + `/ads` report; `artifacts/chat-24/` |
| CHAT-25 Intents | **done** | `55f887d` | `057_intents.sql` | Intent manager + intent_hints; `artifacts/chat-25/` |
| CHAT-26 Re-verify (13/14/15) | **done** | _(pending commit)_ | — | White-label + 1293 tests + UI audit; `artifacts/chat-26/` |

## Migrations owner must apply on wacrm-staging

- `043_astra_connect_adapter.sql`
- `044_astra_connect_tenant_secret.sql`
- `045_astra_usage_metering.sql`
- `046_astra_connect_read_api.sql`
- `047_consent_ledger.sql`
- `048_integrations_hub.sql` ← CHAT-16
- `049_webhook_retry_queue.sql` ← CHAT-17
- `050_ecommerce_integrations.sql` ← CHAT-18
- `051_payment_links.sql` ← CHAT-19
- `052_google_sheets_sync.sql` ← CHAT-20
- `053_crm_push.sql` ← CHAT-21
- `054_messaging_channels.sql` ← CHAT-22
- `055_flow_builder_nodes.sql` ← CHAT-23
- `056_ctwa_ads_attribution.sql` ← CHAT-24
- `057_intents.sql` ← CHAT-25

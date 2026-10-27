# Astra WhatsApp usage metering

Astra Chat records per-account WhatsApp usage for billing. Counters are
stored in `astra_usage_daily` (migration `045_astra_usage_metering.sql`).

## Counters

| Column | Kind | When incremented |
|---|---|---|
| `inbound_messages` | `inbound_message` | Customer WhatsApp message persisted |
| `outbound_messages` | `outbound_message` | Any successful outbound Meta send that is not a template |
| `template_sends` | `template_send` | Successful template send (inbox, broadcast, automation) |
| `conversations` | `conversation` | New conversation created for an inbound |

Rows are keyed by `(account_id, day)` in UTC (`YYYY-MM-DD`).

## Billing webhook

When `BILLING_WEBHOOK_URL` is set, every counter increment also POSTs a
signed JSON event to that URL. When the URL is unset the emitter is a
no-op.

### Env

| Variable | Required | Notes |
|---|---|---|
| `BILLING_WEBHOOK_URL` | no | Absolute HTTPS URL. Empty → no-op |
| `BILLING_WEBHOOK_SECRET` | no | HMAC secret (≥16). Falls back to `WACRM_ADAPTER_SECRET` |

### Headers (same style as the Astra Connect adapter)

```
Content-Type: application/json
X-Astra-Timestamp: <unix seconds>
X-Astra-Signature: sha256=<hex>
```

Signed message: `"${timestamp}.${rawBody}"` with HMAC-SHA256.
Verification should accept lowercase or uppercase hex and reject
timestamps more than 300 seconds off.

### Payload

```json
{
  "type": "whatsapp.usage",
  "account_id": "uuid",
  "kind": "inbound_message",
  "quantity": 1,
  "day": "2026-10-27",
  "occurred_at": "2026-10-27T17:00:00.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `type` | string | Always `whatsapp.usage` |
| `account_id` | uuid string | Astra Chat account id |
| `kind` | string | One of `inbound_message`, `outbound_message`, `template_send`, `conversation` |
| `quantity` | number | Usually `1` |
| `day` | string | UTC calendar day for the rollup row |
| `occurred_at` | ISO 8601 | Event time |

Delivery is best-effort: metering never blocks WhatsApp send/receive.
On 5xx/network the client retries once; 429 is not waited on for billing.

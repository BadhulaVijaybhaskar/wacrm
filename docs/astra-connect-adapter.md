# Astra Connect WhatsApp adapter (wacrm side)

wacrm forwards inbound WhatsApp messages to Astra Connect when an account
opts in. Connect's AI Employee replies; wacrm sends the reply on WhatsApp
and keeps the shared inbox for human handoff.

Contract source of truth: Astra Connect `docs/wacrm-adapter-contract.md` (v2).

## Enable

1. Set env on the server:
   - `CONNECT_ADAPTER_URL` — Connect base URL (no trailing slash)
   - `WACRM_ADAPTER_SECRET` — shared HMAC secret (≥16 chars), same value
     as Connect's `WACRM_ADAPTER_SECRET` (global fallback)
   - `NEXT_PUBLIC_SITE_URL` — public https origin Connect may fetch
     signed media from (must be allow-listed in Connect's
     `WACRM_MEDIA_HOSTS`)
2. Apply migrations `043_astra_connect_adapter.sql` and
   `044_astra_connect_tenant_secret.sql` (staging only when ready).
3. Per account (admin): open **Settings → Astra Connect** in Astra Chat,
   or call
   `PATCH /api/whatsapp/config/astra-connect`
   `{ "enabled": true, "tenant_id": "t_…", "secret": "…" }`.

   `secret` is optional. When set it is stored encrypted with
   `ENCRYPTION_KEY` and used for outbound HMAC instead of the global
   env secret. Rotating a secret keeps the previous one accepted for
   24 hours. Pass `"secret": null` to clear the per-account secret.

   `GET /api/whatsapp/config/astra-connect` returns
   `{ env_configured, enabled, tenant_id, phone_number_id, has_whatsapp_config }`
   so the Settings UI can show whether the server env is ready.

When the adapter is on, Astra Chat's built-in AI auto-reply does **not**
also reply for that account.

## Behaviour

| Event | Action |
|---|---|
| Inbound customer message | `POST /api/channels/whatsapp/inbound` → send `reply_text`; honour `handoff`. Optional `intent_hints` (CHAT-25) may be included — see below. |
| Agent / template / broadcast / automation / flow outbound | `POST /api/channels/whatsapp/message` (best-effort; never blocks the Meta send) |
| Take over (pause AI) | `POST /handoff` with `handoff:true` |
| Resume AI / close chat | `POST /handoff` with `handoff:false` |
| Media | Mirrored (or re-fetched from Meta), exposed as ~15 min signed URL under `/api/astra-connect/media/[token]` |

Client policy: 30 s timeout; one retry on network/5xx with the same
`message_id`; on 429 wait `Retry-After` (Connect sends `55`) and resend
with the same body; otherwise hand the thread to a human.

HMAC signatures use lowercase hex when we sign. Verification accepts
either lowercase or uppercase hex (Connect accepts both).

## Optional `intent_hints` (CHAT-25)

When Astra Chat has enabled intents with training phrases, the inbound
adapter POST may include an optional `intent_hints` array. Connect's AI
Employee may use these as soft classification hints; they are never
required and may be omitted when nothing matches.

```json
{
  "tenant_id": "t_…",
  "phone_number_id": "…",
  "customer_phone": "+9198…",
  "message_id": "wamid.…",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "text": "where is my order",
  "intent_hints": [
    {
      "name": "order_status",
      "display_name": "Order status",
      "confidence": 1,
      "matched_phrase": "where is my order"
    }
  ]
}
```

When the adapter is **off**, the same local matcher can start a linked
flow (`trigger_flow_id`) or automation (`trigger_automation_id`) on the
intent. Manage intents under **AI Agents → Intents**.

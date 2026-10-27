# Astra Connect WhatsApp adapter (wacrm side)

wacrm forwards inbound WhatsApp messages to Astra Connect when an account
opts in. Connect's AI Employee replies; wacrm sends the reply on WhatsApp
and keeps the shared inbox for human handoff.

Contract source of truth: Astra Connect `docs/wacrm-adapter-contract.md` (v2).

## Enable

1. Set env on the wacrm server:
   - `CONNECT_ADAPTER_URL` — Connect base URL (no trailing slash)
   - `WACRM_ADAPTER_SECRET` — shared HMAC secret (≥16 chars), same value
     as Connect's `WACRM_ADAPTER_SECRET`
   - `NEXT_PUBLIC_SITE_URL` — public https origin Connect may fetch
     signed media from (must be allow-listed in Connect's
     `WACRM_MEDIA_HOSTS`)
2. Apply migration `043_astra_connect_adapter.sql` (do not apply from this
   PR against a live project until ready).
3. Per account (admin):
   `PATCH /api/whatsapp/config/astra-connect`
   `{ "enabled": true, "tenant_id": "t_…" }`

When the adapter is on, wacrm's built-in AI auto-reply does **not** also
reply for that account.

## Behaviour

| Event | Action |
|---|---|
| Inbound customer message | `POST /api/channels/whatsapp/inbound` → send `reply_text`; honour `handoff` |
| Agent / template outbound | `POST /api/channels/whatsapp/message` |
| Take over (pause AI) | `POST /handoff` with `handoff:true` |
| Resume AI / close chat | `POST /handoff` with `handoff:false` |
| Media | Mirrored (or re-fetched from Meta), exposed as ~15 min signed URL under `/api/astra-connect/media/[token]` |

Client policy: 30 s timeout; one retry on network/5xx with the same
`message_id`; on 429 wait `Retry-After` and resend; otherwise hand the
thread to a human.

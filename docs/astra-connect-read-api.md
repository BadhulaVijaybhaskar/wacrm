# Astra Connect read & handoff API (CHAT-04b)

Astra Chat owns WhatsApp message storage. Connect reads threads from
these server-to-server endpoints instead of storing WhatsApp history
itself. Outbound mirroring to Connect `/message` is opt-in
(`CONNECT_MIRROR_OUTBOUND`, default off).

## Auth

Every request must carry:

```
X-Astra-Timestamp: <unix seconds>
X-Astra-Signature: sha256=<hex>
```

Hex may be lowercase or uppercase. Timestamps older/newer than **300
seconds** are rejected.

### Signed message

| Method | Signed payload |
|---|---|
| `GET` / `HEAD` | `${timestamp}.${pathname}${search}` |
| `POST` (and other bodies) | `${timestamp}.${rawBody}` |

Example GET signing string:

```
1710000000./api/astra-connect/v1/conversations?tenant_id=t_abc&employee_id=emp_1&limit=50
```

Secret resolution (first match wins for outbound; all accepted for verify):

1. Per-tenant current secret (`whatsapp_config.astra_connect_secret_encrypted`)
2. Previous secret while within the 24h rotation window
3. Global `WACRM_ADAPTER_SECRET`

Unknown `tenant_id` or failed auth → **404** (never 403) so tenants cannot
probe each other.

## Rate limit

**120 requests / minute / tenant**. Over limit → `429` with `Retry-After`.

---

## `GET /api/astra-connect/v1/conversations`

### Query

| Param | Required | Notes |
|---|---|---|
| `tenant_id` | yes | Maps to `whatsapp_config.astra_connect_tenant_id` |
| `employee_id` | no | Filters `conversations.astra_employee_id` |
| `phone_number_id` | no | Must match this tenant's number or returns empty |
| `status` | no | `open` / `pending` / `closed` |
| `updated_since` | no | ISO 8601 lower bound on `updated_at` |
| `cursor` | no | Opaque keyset cursor from a prior response |
| `limit` | no | Default 50, max 100 |

### Response `200`

```json
{
  "conversations": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "astra_conversation_id": "conv_abc",
      "employee_id": "emp_1",
      "status": "open",
      "handoff": "ai",
      "unread_count": 2,
      "last_message_preview": "Thanks, see you tomorrow",
      "updated_at": "2026-10-27T17:00:00.000Z",
      "assignee": null,
      "labels": ["vip"],
      "contact": {
        "phone": "+919812345678",
        "name": "Priya",
        "opted_out": false
      }
    }
  ],
  "next_cursor": null
}
```

`handoff` is `"ai"` or `"human"`. `employee_id` comes from the
conversation row, falling back to the number's
`whatsapp_config.astra_employee_id`.

---

## `GET /api/astra-connect/v1/conversations/:id/messages`

### Query

| Param | Required | Notes |
|---|---|---|
| `tenant_id` | yes | |
| `cursor` | no | |
| `limit` | no | Default 50, max 100 |
| `before` | no | ISO upper bound on `created_at` |
| `after` | no | ISO lower bound on `created_at` |

Cross-tenant `:id` → **404**.

### Response `200`

```json
{
  "messages": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "direction": "inbound",
      "type": "text",
      "text": "Hello",
      "media": null,
      "template_name": null,
      "status": "delivered",
      "failure_reason": null,
      "sender": { "kind": "contact" },
      "created_at": "2026-10-27T16:59:00.000Z",
      "whatsapp_message_id": "wamid.IN1"
    },
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "direction": "outbound",
      "type": "text",
      "text": "Hi Priya — how can I help?",
      "media": null,
      "template_name": null,
      "status": "read",
      "failure_reason": null,
      "sender": { "kind": "ai" },
      "created_at": "2026-10-27T16:59:05.000Z",
      "whatsapp_message_id": "wamid.OUT1"
    }
  ],
  "next_cursor": null
}
```

Media, when present, uses short-lived signed URLs from
`GET /api/astra-connect/media/[token]` (existing route).

`sender.kind` is `contact` | `human` | `ai`. Human senders may include
`member_id`.

---

## `POST /api/astra-connect/v1/conversations/:id/takeover`

Sets handoff to **human** so Connect AI replies stop for this thread
until handback. Idempotent. Writes `astra_connect_handoff_audit`.

### Body

```json
{ "tenant_id": "t_abc", "by": "agent@acme.com" }
```

### Response `200`

```json
{
  "conversation_id": "11111111-1111-1111-1111-111111111111",
  "handoff": "human",
  "changed": true
}
```

---

## `POST /api/astra-connect/v1/conversations/:id/handback`

Resumes AI (`handoff: "ai"`). Idempotent. Clears pause + assignment.

### Body

```json
{ "tenant_id": "t_abc", "by": "agent@acme.com" }
```

### Response `200`

```json
{
  "conversation_id": "11111111-1111-1111-1111-111111111111",
  "handoff": "ai",
  "changed": true
}
```

---

## Employee id storage

| Column | Set by |
|---|---|
| `whatsapp_config.astra_employee_id` | Admin PATCH `/api/whatsapp/config/astra-connect` `{ employee_id }` (Settings → Astra Connect) |
| `conversations.astra_employee_id` | Connect inbound `employee_id`, else number default |

## Inbox UI

Settings → Inbox already exposes **Take over** / **Hand back to AI**
(`AiThreadBanner` → `POST /api/ai/autoreply/:id`). Those actions now also
write `astra_connect_handoff_audit` with `source=inbox` and keep notifying
Connect `/handoff` when the adapter is on.

## OpenAPI

See `docs/astra-connect-read-api.openapi.yaml`.

## Migration

`supabase/migrations/046_astra_connect_read_api.sql` (apply to
wacrm-staging by operator).

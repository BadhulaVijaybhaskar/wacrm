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
X-Astra-Tenant: <tenant_id>
```

Hex may be lowercase or uppercase. Timestamps older/newer than **300
seconds** are rejected.

`X-Astra-Tenant` is **required** on every `/api/astra-connect/v1/*` call.
It must equal the `tenant_id` query parameter (GET) or JSON body field
(POST). A missing header → **400**. A mismatch (cross-tenant probe) →
**404**.

### Signed message

Matches the Connect console client (Astraconnect `647b711`). Signature is
HMAC-SHA256 hex as `X-Astra-Signature: sha256=<hex>`, with a **300s**
timestamp window.

| Method | Full signed string |
|---|---|
| `GET` / `HEAD` | `${ts}.${pathWithQuery}.${tenant}` |
| `POST` (and other bodies) | `${ts}.${rawBody}.${tenant}` |

`tenant` is the `X-Astra-Tenant` header value (which must already match
`tenant_id` in the query or JSON body).

Example GET:

```
1710000000./api/astra-connect/v1/conversations?tenant_id=t_abc&employee_id=emp_1&limit=50.t_abc
```

Example POST:

```
1710000000.{"tenant_id":"t_abc","by":"ops@acme.com"}.t_abc
```

The **inbound webhook adapter contract v2** (Connect ← Chat outbound
adapter posts) still signs `${ts}.${rawBody}` only — that contract is
unchanged.

Secret resolution (first match wins for outbound; all accepted for verify):

1. Per-tenant current secret (`whatsapp_config.astra_connect_secret_encrypted`)
2. Previous secret while within the 24h rotation window
3. Global `WACRM_ADAPTER_SECRET`

Unknown `tenant_id` or failed auth → **404** (never 403) so tenants cannot
probe each other.

## Rate limit

| Surface | Budget |
|---|---|
| Reads (`GET` conversations / messages) | **600 / minute / tenant** |
| Takeover / handback (`POST`) | **120 / minute / tenant** |

`304 Not Modified` responses consume **0.25** of a read unit. Over limit
→ `429` with `Retry-After`.

## Conditional requests (ETag)

`GET` conversations and `GET` messages support:

```
If-None-Match: <ETag from a prior response>
```

The `ETag` is derived from **max timestamp + count** for the filtered
collection (`max(updated_at)` for conversations, `max(created_at)` for
messages). When nothing changed the API returns **304** with the same
`ETag` and an empty body.

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
      "tenant_id": "t_abc",
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

Headers include `ETag`. `handoff` is `"ai"` or `"human"`. `employee_id`
comes from the conversation row, falling back to the number's
`whatsapp_config.astra_employee_id`. Every conversation object includes
`tenant_id`.

---

## `GET /api/astra-connect/v1/conversations/:id/messages`

### Query

| Param | Required | Notes |
|---|---|---|
| `tenant_id` | yes | |
| `before` | no | Preferred **older-page cursor**: opaque keyset from `next_cursor`, or an ISO-8601 upper bound on `created_at` |
| `cursor` | no | Alias for an opaque keyset cursor (same encoding as `next_cursor`) |
| `limit` | no | Default 50, max 100 |
| `after` | no | ISO lower bound on `created_at` |

Ordering is **newest first**, stable by `(created_at DESC, id DESC)`.
Pass the previous page's `next_cursor` as `before` to load older
messages. Cross-tenant `:id` → **404**.

### Response `200`

```json
{
  "messages": [
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "tenant_id": "t_abc",
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
      "tenant_id": "t_abc",
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

Every message object includes `tenant_id`. Media, when present, uses
short-lived signed URLs from `GET /api/astra-connect/media/[token]`.

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

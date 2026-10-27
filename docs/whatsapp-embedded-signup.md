# WhatsApp Embedded Signup (scaffolding)

Astra Chat can optionally offer Meta’s Embedded Signup flow behind the
env flag `WHATSAPP_EMBEDDED_SIGNUP=1`. When the flag is off the Settings
UI hides the quick-connect card and the API returns 404.

## Env

| Variable | Required | Notes |
|---|---|---|
| `WHATSAPP_EMBEDDED_SIGNUP` | no | `1` / `true` enables the feature |
| `META_STUB` | no | `1` / `true` → fake WABA + phone IDs, **never calls Meta** |
| `META_APP_ID` | live only | Meta App id used for the OAuth code exchange |
| `META_APP_SECRET` | live only | First entry if comma-separated (same as other Meta helpers) |
| `ENCRYPTION_KEY` | yes when persisting | Encrypts the resulting access token |

## API

### `GET /api/whatsapp/config/embedded-signup` (admin+)

```json
{ "enabled": true, "stub": true, "app_id": "123…" }
```

### `POST /api/whatsapp/config/embedded-signup` (admin+)

Body:

```json
{
  "code": "<oauth code from Embedded Signup>",
  "waba_id": "<from sessionInfoListener>",
  "phone_number_id": "<from sessionInfoListener>",
  "persist": true
}
```

In `META_STUB` mode only `code` is required; the route returns stable
numeric fake IDs (`900000000000001` / `900000000000002`) and encrypts a
stub token into `whatsapp_config`. Live mode exchanges the code via
Graph OAuth and requires the session WABA / phone IDs. Unit tests always
run on the stub path (or inject a mock `fetch`).

## UI

Settings → WhatsApp shows a **Quick connect** card when the flag is on.
In stub mode a single click completes signup. Manual credential fields
remain available as a fallback.

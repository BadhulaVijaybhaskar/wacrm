# WhatsApp Embedded Signup (review before enabling)

Base: `deploy/wa-golive2-after-call-invite`. Flag `WACRM_EMBEDDED_SIGNUP=1` enables new endpoints; default is off (404). Existing `WHATSAPP_EMBEDDED_SIGNUP` scaffolding remains independent and should be disabled for production.

## Environment
Set `META_APP_ID`, `META_APP_SECRET`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`, `META_GRAPH_VERSION` (defaults `v23.0`), and `WACRM_TOKEN_ENC_KEY` (base64 of 32 secure random bytes, generate using `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). Never put real secrets in source control.

## Meta developer dashboard
Configure Facebook Login for Business with the WhatsApp Embedded Signup configuration ID. Set Allowed Domains, app domain, and OAuth redirect `https://wa.astraconnect.io` as required by Meta, and verify Graph permissions, app review, and webhook subscriptions.

## Database review / rollback
Review `supabase/shared-project/wacrm_embedded_signup.sql` against the live `wacrm.accounts` table and role grants. Apply only in a controlled maintenance process. To undo, review and manually run `supabase/shared-project/rollback_wacrm_embedded_signup.sql` (destructive: permanently deletes connection rows).

## Security
Service role claims numbers atomically. Authenticated members only read non-secret columns. Never expose OAuth codes, tokens, registration PINs, or Meta raw error details. Encryption key rotation requires planned re-encryption.

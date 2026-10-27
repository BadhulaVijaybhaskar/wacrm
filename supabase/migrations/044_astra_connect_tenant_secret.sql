-- ============================================================
-- 044_astra_connect_tenant_secret
--
-- Per-account Astra Connect adapter HMAC secret (encrypted at rest
-- with ENCRYPTION_KEY). Falls back to global WACRM_ADAPTER_SECRET
-- when unset. On rotation the previous ciphertext is kept and remains
-- valid for 24 hours (astra_connect_secret_previous_expires_at).
--
-- Idempotent — safe to re-run. Apply to staging only when ready.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS astra_connect_secret_encrypted TEXT;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS astra_connect_secret_previous_encrypted TEXT;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS astra_connect_secret_previous_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN whatsapp_config.astra_connect_secret_encrypted IS
  'AES-GCM ciphertext (ENCRYPTION_KEY) of the per-account Astra Connect '
  'adapter HMAC secret. When null, the server falls back to '
  'WACRM_ADAPTER_SECRET.';

COMMENT ON COLUMN whatsapp_config.astra_connect_secret_previous_encrypted IS
  'Previous per-account adapter secret ciphertext kept during rotation. '
  'Valid until astra_connect_secret_previous_expires_at (24h window).';

COMMENT ON COLUMN whatsapp_config.astra_connect_secret_previous_expires_at IS
  'When the previous adapter secret stops being accepted (rotation + 24h).';

-- ============================================================
-- 043_astra_connect_adapter
--
-- Opt-in Astra Connect WhatsApp adapter (wacrm → Connect).
-- When enabled for an account, inbound customer messages are
-- forwarded to Astra Connect's AI Employee; wacrm's built-in AI
-- auto-reply stands down for that account.
--
-- Columns live on whatsapp_config (one WhatsApp number per account):
--   - astra_connect_enabled  — per-account master switch (default off)
--   - astra_connect_tenant_id — Astra Connect tenant id sent on every call
--
-- Global env (not stored here): CONNECT_ADAPTER_URL, WACRM_ADAPTER_SECRET.
-- Per-tenant adapter secrets are a future Connect-side TODO; wacrm is
-- shaped so astra_connect_secret could be added later without reshaping.
--
-- Also stores Connect's conversation id on the local thread so handoff
-- resume/close can address it without re-resolving.
--
-- Idempotent — safe to re-run. Do NOT apply to a live project from
-- this PR; ship the file only.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS astra_connect_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS astra_connect_tenant_id TEXT;

COMMENT ON COLUMN whatsapp_config.astra_connect_enabled IS
  'When true, inbound WhatsApp messages for this account are POSTed to '
  'Astra Connect (/api/channels/whatsapp/inbound) instead of wacrm''s '
  'built-in AI auto-reply. Requires CONNECT_ADAPTER_URL and '
  'WACRM_ADAPTER_SECRET to be configured on the server.';

COMMENT ON COLUMN whatsapp_config.astra_connect_tenant_id IS
  'Astra Connect tenant_id forwarded on every adapter call. Required '
  'when astra_connect_enabled is true.';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS astra_conversation_id TEXT;

COMMENT ON COLUMN conversations.astra_conversation_id IS
  'Astra Connect conversation id (conv_…) for this WhatsApp thread, '
  'populated from adapter responses. Used for /handoff when an agent '
  'closes or releases the chat.';

CREATE INDEX IF NOT EXISTS idx_conversations_astra_conversation_id
  ON conversations (astra_conversation_id)
  WHERE astra_conversation_id IS NOT NULL;

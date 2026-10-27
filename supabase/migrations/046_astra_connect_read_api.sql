-- ============================================================
-- 046_astra_connect_read_api
--
-- Connect reads WhatsApp threads from Astra Chat (CHAT-04b):
--   - astra_employee_id on whatsapp_config (per number) and
--     conversations (from Connect inbound, else number fallback)
--   - handoff audit log for takeover / handback
--
-- Idempotent. Apply to staging only when ready.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS astra_employee_id TEXT;

COMMENT ON COLUMN whatsapp_config.astra_employee_id IS
  'Optional Astra Connect employee id for this WhatsApp number. '
  'Used as the default when filtering conversations by employee_id.';

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS astra_employee_id TEXT;

COMMENT ON COLUMN conversations.astra_employee_id IS
  'Astra Connect employee id for this thread. Set from Connect inbound '
  'responses when present; otherwise falls back to the number default.';

CREATE INDEX IF NOT EXISTS idx_conversations_astra_employee_id
  ON conversations (account_id, astra_employee_id)
  WHERE astra_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_astra_tenant
  ON whatsapp_config (astra_connect_tenant_id)
  WHERE astra_connect_tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS astra_connect_handoff_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('takeover', 'handback')),
  by_actor TEXT,
  source TEXT NOT NULL DEFAULT 'api'
    CHECK (source IN ('api', 'inbox', 'adapter')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_astra_handoff_audit_conversation
  ON astra_connect_handoff_audit (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_astra_handoff_audit_account
  ON astra_connect_handoff_audit (account_id, created_at DESC);

COMMENT ON TABLE astra_connect_handoff_audit IS
  'Idempotent audit of AI↔human handoff transitions for Connect + inbox.';

ALTER TABLE astra_connect_handoff_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS astra_connect_handoff_audit_deny_all
  ON astra_connect_handoff_audit;
CREATE POLICY astra_connect_handoff_audit_deny_all
  ON astra_connect_handoff_audit
  FOR ALL
  USING (false)
  WITH CHECK (false);

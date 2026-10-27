-- ============================================================
-- 053_crm_push.sql — HubSpot / Zoho / Astra CRM push log
-- Idempotent. Postgres 17 compatible.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_push_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('hubspot', 'zoho', 'astra_crm')),
  entity_type     text NOT NULL CHECK (entity_type IN ('contact', 'note', 'conversation_summary')),
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  external_id     text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'error', 'deduped')),
  attempt         integer NOT NULL DEFAULT 0,
  last_error      text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_push_log_account_idx
  ON crm_push_log (account_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS crm_push_log_retry_idx
  ON crm_push_log (status, updated_at)
  WHERE status IN ('pending', 'error');

ALTER TABLE crm_push_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_push_log_select ON crm_push_log;
CREATE POLICY crm_push_log_select ON crm_push_log FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS crm_push_log_write ON crm_push_log;
CREATE POLICY crm_push_log_write ON crm_push_log FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

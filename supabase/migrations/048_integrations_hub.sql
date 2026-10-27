-- ============================================================
-- 048_integrations_hub.sql — Settings → Integrations hub
--
-- Per-account connector credentials (AES-256-GCM ciphertext) and an
-- append-only event log. Provider-specific behaviour lives in app
-- code; this migration only stores connection state.
--
-- Idempotent — safe to run multiple times. Postgres 17 compatible.
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider              text NOT NULL,
  status                text NOT NULL DEFAULT 'disconnected'
                          CHECK (status IN ('disconnected', 'connected', 'error')),
  -- AES-GCM ciphertext of a JSON object of secrets (never returned after write).
  credentials_encrypted text,
  -- Non-secret config (shop domain, sheet id, field maps, etc.).
  config                jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_name          text,
  last_tested_at        timestamptz,
  last_error            text,
  connected_at          timestamptz,
  connected_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider)
);

CREATE INDEX IF NOT EXISTS integration_connections_account_id_idx
  ON integration_connections (account_id);

CREATE INDEX IF NOT EXISTS integration_connections_provider_idx
  ON integration_connections (provider);

ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_connections_select ON integration_connections;
CREATE POLICY integration_connections_select ON integration_connections FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS integration_connections_insert ON integration_connections;
CREATE POLICY integration_connections_insert ON integration_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_connections_update ON integration_connections;
CREATE POLICY integration_connections_update ON integration_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_connections_delete ON integration_connections;
CREATE POLICY integration_connections_delete ON integration_connections FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Append-only event / delivery log per integration.
CREATE TABLE IF NOT EXISTS integration_event_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider    text NOT NULL,
  event_type  text NOT NULL,
  status      text NOT NULL DEFAULT 'info'
                CHECK (status IN ('info', 'success', 'error', 'skipped')),
  message     text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_event_log_account_provider_idx
  ON integration_event_log (account_id, provider, created_at DESC);

ALTER TABLE integration_event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_event_log_select ON integration_event_log;
CREATE POLICY integration_event_log_select ON integration_event_log FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS integration_event_log_insert ON integration_event_log;
CREATE POLICY integration_event_log_insert ON integration_event_log FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

-- No UPDATE/DELETE policies — append-only from the app's perspective.

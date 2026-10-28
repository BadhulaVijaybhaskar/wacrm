-- ============================================================
-- wacrm_connect_provisioned.sql
--
-- Additive shared-project pack piece for Connect §15
-- (whatsapp.connect_provisioned). CREATE-only — does not alter
-- existing tables beyond this new relation.
--
-- Voice review note: run after wacrm_schema.sql on the shared
-- project. Pair with rollback_wacrm_connect_provisioned.sql.
-- Do NOT apply from Chat agents without Voice sign-off.
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

CREATE TABLE IF NOT EXISTS wacrm.astra_connect_provisions (
  provision_id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES wacrm.accounts(id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  phone_number_id text NOT NULL,
  config_id uuid NOT NULL REFERENCES wacrm.whatsapp_config(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE wacrm.astra_connect_provisions IS
  'Idempotency ledger for Connect whatsapp.connect_provisioned events (§15).';

CREATE INDEX IF NOT EXISTS astra_connect_provisions_account_id_idx
  ON wacrm.astra_connect_provisions (account_id);

CREATE INDEX IF NOT EXISTS astra_connect_provisions_phone_number_id_idx
  ON wacrm.astra_connect_provisions (phone_number_id);

ALTER TABLE wacrm.astra_connect_provisions ENABLE ROW LEVEL SECURITY;

-- Explicit deny-all for authenticated/anon (service_role bypasses RLS).
DROP POLICY IF EXISTS astra_connect_provisions_deny_all ON wacrm.astra_connect_provisions;
CREATE POLICY astra_connect_provisions_deny_all ON wacrm.astra_connect_provisions
  USING (false) WITH CHECK (false);

-- Service-role / SECURITY DEFINER paths write this table; authenticated
-- users have no direct access (Connect HMAC routes use the admin client).
REVOKE ALL ON TABLE wacrm.astra_connect_provisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE wacrm.astra_connect_provisions TO service_role;

COMMIT;

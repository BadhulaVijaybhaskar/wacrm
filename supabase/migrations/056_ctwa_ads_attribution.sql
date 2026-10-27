-- ============================================================
-- 056_ctwa_ads_attribution.sql — Click-to-WhatsApp ad referral
-- Idempotent. Postgres 17 compatible.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ctwa_source_id text,
  ADD COLUMN IF NOT EXISTS ctwa_clid text,
  ADD COLUMN IF NOT EXISTS ctwa_headline text,
  ADD COLUMN IF NOT EXISTS ctwa_ad_id text,
  ADD COLUMN IF NOT EXISTS ctwa_body text,
  ADD COLUMN IF NOT EXISTS ctwa_source_type text,
  ADD COLUMN IF NOT EXISTS ctwa_source_url text,
  ADD COLUMN IF NOT EXISTS ctwa_captured_at timestamptz;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ctwa_source_id text,
  ADD COLUMN IF NOT EXISTS ctwa_clid text,
  ADD COLUMN IF NOT EXISTS ctwa_headline text,
  ADD COLUMN IF NOT EXISTS ctwa_ad_id text,
  ADD COLUMN IF NOT EXISTS ctwa_body text,
  ADD COLUMN IF NOT EXISTS ctwa_source_type text,
  ADD COLUMN IF NOT EXISTS ctwa_source_url text,
  ADD COLUMN IF NOT EXISTS ctwa_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS ctwa_converted_at timestamptz;

CREATE TABLE IF NOT EXISTS ad_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  source_id text,
  ctwa_clid text,
  headline text,
  ad_id text,
  body text,
  source_type text,
  source_url text,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ad_attributions_account_ad_idx
  ON ad_attributions (account_id, ad_id, source_id);

CREATE INDEX IF NOT EXISTS ad_attributions_account_created_idx
  ON ad_attributions (account_id, created_at DESC);

ALTER TABLE ad_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_attributions_select ON ad_attributions;
CREATE POLICY ad_attributions_select ON ad_attributions
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS ad_attributions_insert ON ad_attributions;
CREATE POLICY ad_attributions_insert ON ad_attributions
  FOR INSERT WITH CHECK (is_account_member(account_id));

DROP POLICY IF EXISTS ad_attributions_update ON ad_attributions;
CREATE POLICY ad_attributions_update ON ad_attributions
  FOR UPDATE USING (is_account_member(account_id));

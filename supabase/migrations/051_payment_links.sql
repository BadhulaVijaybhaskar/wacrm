-- ============================================================
-- 051_payment_links.sql — Razorpay / Stripe payment links in chat
-- Idempotent. Postgres 17 compatible.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  provider         text NOT NULL CHECK (provider IN ('razorpay', 'stripe')),
  external_id      text,
  url              text NOT NULL,
  amount_cents     integer NOT NULL,
  currency         text NOT NULL DEFAULT 'INR',
  description      text,
  status           text NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created', 'paid', 'failed', 'expired', 'cancelled')),
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_links_account_idx
  ON payment_links (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_links_conversation_idx
  ON payment_links (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_links_external_idx
  ON payment_links (provider, external_id);

ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_links_select ON payment_links;
CREATE POLICY payment_links_select ON payment_links FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS payment_links_write ON payment_links;
CREATE POLICY payment_links_write ON payment_links FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

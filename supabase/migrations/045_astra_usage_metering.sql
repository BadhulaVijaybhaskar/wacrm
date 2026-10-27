-- ============================================================
-- 045_astra_usage_metering
--
-- Per-account WhatsApp usage counters for Astra billing.
-- Daily rollup rows are upserted by the app; BILLING_WEBHOOK_URL
-- receives signed event payloads (no-op when unset).
--
-- Idempotent — safe to re-run. Apply to staging only when ready.
-- ============================================================

CREATE TABLE IF NOT EXISTS astra_usage_daily (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  inbound_messages BIGINT NOT NULL DEFAULT 0,
  outbound_messages BIGINT NOT NULL DEFAULT 0,
  template_sends BIGINT NOT NULL DEFAULT 0,
  conversations BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, day)
);

CREATE INDEX IF NOT EXISTS idx_astra_usage_daily_day
  ON astra_usage_daily (day);

COMMENT ON TABLE astra_usage_daily IS
  'Per-account daily WhatsApp usage counters for Astra billing metering.';

ALTER TABLE astra_usage_daily ENABLE ROW LEVEL SECURITY;

-- Service-role / backend only — no end-user policies. Matches other
-- internal metering tables that the Next.js server writes via the
-- service role (or an elevated account client).
DROP POLICY IF EXISTS astra_usage_daily_deny_all ON astra_usage_daily;
CREATE POLICY astra_usage_daily_deny_all
  ON astra_usage_daily
  FOR ALL
  USING (false)
  WITH CHECK (false);

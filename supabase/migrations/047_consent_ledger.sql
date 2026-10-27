-- ============================================================
-- 047_consent_ledger
--
-- CHAT-11: opt-out / opt-in keywords + append-only consent ledger.
--
--   1. contacts.opted_out / opted_out_at — current consent state
--   2. consent_events — append-only audit (opt_out, opt_in, send_skipped)
--
-- Staging only (wacrm-staging). Idempotent.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.opted_out IS
  'True when the contact has opted out of proactive WhatsApp sends '
  '(broadcasts, automations, adapter replies). Manual agent replies '
  'are still allowed.';

COMMENT ON COLUMN contacts.opted_out_at IS
  'When opted_out last flipped to true. Cleared on opt-in.';

CREATE INDEX IF NOT EXISTS idx_contacts_opted_out
  ON contacts (account_id)
  WHERE opted_out = TRUE;

CREATE TABLE IF NOT EXISTS consent_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('opt_out', 'opt_in', 'send_skipped')),
  source TEXT NOT NULL DEFAULT 'inbound_keyword'
    CHECK (source IN (
      'inbound_keyword',
      'broadcast',
      'automation',
      'adapter',
      'manual',
      'system'
    )),
  keyword TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_events_contact
  ON consent_events (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_consent_events_account
  ON consent_events (account_id, created_at DESC);

COMMENT ON TABLE consent_events IS
  'Append-only consent / opt-out ledger. Rows are never updated or '
  'deleted by the application (CASCADE only on contact/account delete).';

ALTER TABLE consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_events_select ON consent_events;
CREATE POLICY consent_events_select ON consent_events
  FOR SELECT USING (is_account_member(account_id));

-- Members may append events (keyword processing + send skips). No
-- UPDATE/DELETE policies — ledger is append-only under RLS.
DROP POLICY IF EXISTS consent_events_insert ON consent_events;
CREATE POLICY consent_events_insert ON consent_events
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

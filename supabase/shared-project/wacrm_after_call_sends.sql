-- ============================================================
-- wacrm_after_call_sends.sql
--
-- Additive shared-project pack piece for Connect §16.2
-- (POST /api/astra-connect/v1/whatsapp/send idempotency).
-- CREATE-only — does not alter existing tables beyond this
-- new relation.
--
-- Rows start as state='pending' (reservation before Meta).
-- Final outcomes flip to state='final'. Retryable failures
-- (429 / 5xx) DELETE the pending row so Connect can retry.
-- Stale pending (> 5 minutes) may be taken over by a later
-- attempt (see after-call-templates.ts PENDING_STALE_MS).
--
-- Voice review note: run after wacrm_schema.sql on the shared
-- project. Pair with rollback_wacrm_after_call_sends.sql.
-- Do NOT apply from Chat agents without Voice sign-off.
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

CREATE TABLE IF NOT EXISTS wacrm.astra_after_call_sends (
  account_id uuid NOT NULL REFERENCES wacrm.accounts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  tenant_id text NOT NULL,
  call_id text,
  send_id text,
  -- pending = reserved / in-flight; final = durable first result
  state text NOT NULL DEFAULT 'pending'
    CHECK (state = ANY (ARRAY['pending'::text, 'final'::text])),
  status_code integer NOT NULL DEFAULT 0,
  response_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_id text,
  dry_run boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, idempotency_key)
);

COMMENT ON TABLE wacrm.astra_after_call_sends IS
  'Idempotency-Key ledger for Connect whatsapp.after_call (§16.2). pending reserves before Meta; final stores durable outcomes only.';

COMMENT ON COLUMN wacrm.astra_after_call_sends.state IS
  'pending = in-flight reservation; final = success/dry_run/deterministic 4xx. Retryable errors delete the pending row.';

CREATE INDEX IF NOT EXISTS astra_after_call_sends_tenant_id_idx
  ON wacrm.astra_after_call_sends (tenant_id);

CREATE INDEX IF NOT EXISTS astra_after_call_sends_call_id_idx
  ON wacrm.astra_after_call_sends (call_id);

CREATE INDEX IF NOT EXISTS astra_after_call_sends_pending_created_idx
  ON wacrm.astra_after_call_sends (created_at)
  WHERE state = 'pending';

ALTER TABLE wacrm.astra_after_call_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS astra_after_call_sends_deny_all ON wacrm.astra_after_call_sends;
CREATE POLICY astra_after_call_sends_deny_all ON wacrm.astra_after_call_sends
  USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE wacrm.astra_after_call_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE wacrm.astra_after_call_sends TO service_role;

COMMIT;

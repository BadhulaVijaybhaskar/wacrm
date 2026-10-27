-- ============================================================
-- 052_google_sheets_sync.sql — Google Sheets contact sync runs
-- Idempotent. Postgres 17 compatible.
-- ============================================================

CREATE TABLE IF NOT EXISTS sheets_sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('import', 'export')),
  spreadsheet_id  text NOT NULL,
  sheet_name      text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'error')),
  rows_ok         integer NOT NULL DEFAULT 0,
  rows_error      integer NOT NULL DEFAULT 0,
  message         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE INDEX IF NOT EXISTS sheets_sync_runs_account_idx
  ON sheets_sync_runs (account_id, created_at DESC);

ALTER TABLE sheets_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sheets_sync_runs_select ON sheets_sync_runs;
CREATE POLICY sheets_sync_runs_select ON sheets_sync_runs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS sheets_sync_runs_write ON sheets_sync_runs;
CREATE POLICY sheets_sync_runs_write ON sheets_sync_runs FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

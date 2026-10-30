-- REVIEW ONLY. Do not apply automatically. Dedicated schema only.
BEGIN;
ALTER TABLE wacrm.wa_connections ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz;
CREATE INDEX IF NOT EXISTS wa_connections_health_check_idx
 ON wacrm.wa_connections (last_health_check_at ASC NULLS FIRST) WHERE status = 'connected';
COMMIT;

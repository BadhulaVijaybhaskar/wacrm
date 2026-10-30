-- REVIEW ONLY: removes health check rotation metadata.
BEGIN;
DROP INDEX IF EXISTS wacrm.wa_connections_health_check_idx;
ALTER TABLE wacrm.wa_connections DROP COLUMN IF EXISTS last_health_check_at;
COMMIT;

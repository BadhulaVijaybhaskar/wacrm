-- =============================================================================
-- Astra Chat shared project: pg_cron jobs
-- Migrations 001-058 schedule no pg_cron jobs (verified: grep cron.schedule
-- supabase/migrations returns nothing).  Chat sweeps run from HTTP cron routes
-- (/api/*/cron).  Intentionally a no-op; nothing to install.
-- =============================================================================
SELECT 'wacrm: no pg_cron jobs to install' AS note;

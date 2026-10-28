-- =============================================================================
-- Shared Supabase project — pg_cron jobs for Chat (wacrm)
--
-- Migrations 001–058 do not schedule pg_cron jobs. Chat relies on HTTP cron
-- routes (Netlify/Vercel) for sweeps, broadcasts, and automations.
-- =============================================================================

-- No wacrm_* cron jobs required.

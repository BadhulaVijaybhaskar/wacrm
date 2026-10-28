-- ============================================================
-- rollback_wacrm_after_call_sends.sql
--
-- Exact inverse of wacrm_after_call_sends.sql.
-- Does not touch whatsapp_config or other relations.
-- Do NOT apply without Voice sign-off.
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

DROP TABLE IF EXISTS wacrm.astra_after_call_sends;

COMMIT;

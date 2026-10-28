-- ============================================================
-- rollback_wacrm_connect_provisioned.sql
--
-- Drops the §15 idempotency ledger only. Safe to run before a full
-- rollback_wacrm.sql; does not touch whatsapp_config rows that were
-- written by connect-provisioned (tokens remain until manual cleanup
-- or full schema rollback).
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

DROP TABLE IF EXISTS wacrm.astra_connect_provisions;

COMMIT;

-- REVIEW ONLY: deletes connection records and their encrypted tokens.
-- The claim RPC returns claimed_pin_ciphertext and stored_token_ciphertext (service-only).
-- OUT columns do not change its nine-argument identity; this DROP matches the main draft re-run guard.
BEGIN;
DROP FUNCTION IF EXISTS wacrm.claim_wa_connection(uuid,text,text,text,text,text,text,text,text);
DROP VIEW IF EXISTS wacrm.wa_connections_public;
-- Dropping the table also removes its set_updated_at trigger.
DROP TABLE IF EXISTS wacrm.wa_connections;
COMMIT;

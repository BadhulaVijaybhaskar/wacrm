-- REVIEW ONLY: deletes connection records and their encrypted tokens.
-- The claim RPC returns two service-only ciphertext snapshot columns in Round 3.
-- OUT columns do not change its nine-argument identity; this DROP still matches.
BEGIN;
DROP FUNCTION IF EXISTS wacrm.claim_wa_connection(uuid,text,text,text,text,text,text,text,text);
DROP VIEW IF EXISTS wacrm.wa_connections_public;
DROP TABLE IF EXISTS wacrm.wa_connections;
COMMIT;

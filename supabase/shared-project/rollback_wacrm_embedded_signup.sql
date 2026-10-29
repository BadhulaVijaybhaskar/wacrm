-- REVIEW ONLY: deletes connection records and their encrypted tokens.
BEGIN;
DROP FUNCTION IF EXISTS wacrm.claim_wa_connection(uuid,text,text,text,text,text,text,text,text);
DROP VIEW IF EXISTS wacrm.wa_connections_public;
DROP TABLE IF EXISTS wacrm.wa_connections;
COMMIT;

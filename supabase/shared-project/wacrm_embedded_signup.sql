-- REVIEW ONLY. Do not apply automatically. Dedicated schema only.
BEGIN;
CREATE TABLE IF NOT EXISTS wacrm.wa_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES wacrm.accounts(id) ON DELETE CASCADE,
 waba_id text NOT NULL,
 phone_number_id text NOT NULL UNIQUE,
 business_id text,
 display_phone_number text,
 verified_name text,
 quality_rating text,
 token_ciphertext text NOT NULL,
 pin_ciphertext text,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','disconnected','error')),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_connections_account_idx ON wacrm.wa_connections(account_id);
ALTER TABLE wacrm.wa_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wacrm.wa_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON wacrm.wa_connections TO service_role;
-- Deliberately no authenticated grants on the secrets-bearing base table.
-- This security-invoker view is public to members but contains no secrets.
CREATE OR REPLACE VIEW wacrm.wa_connections_public WITH (security_invoker = true) AS
 SELECT id, account_id, waba_id, phone_number_id, business_id, display_phone_number,
 verified_name, quality_rating, status, last_error, created_at, updated_at
 FROM wacrm.wa_connections;
-- Read-only column grants on the base table allow security-invoker view reads.
GRANT SELECT (id,account_id,waba_id,phone_number_id,business_id,display_phone_number,
 verified_name,quality_rating,status,last_error,created_at,updated_at)
 ON wacrm.wa_connections TO authenticated;
GRANT SELECT ON wacrm.wa_connections_public TO authenticated;
DROP POLICY IF EXISTS wa_connections_member_read ON wacrm.wa_connections;
CREATE POLICY wa_connections_member_read ON wacrm.wa_connections FOR SELECT TO authenticated
 USING (wacrm.is_account_member(account_id,'viewer'::wacrm.account_role_enum));
-- Atomic ownership claim. Disconnected/error rows and stale pending rows can transfer.
-- Connected reconnects retain their live token/status until Meta provisioning succeeds.
-- Drop the exact input signature so older draft OUT shapes can be replaced on re-run.
DROP FUNCTION IF EXISTS wacrm.claim_wa_connection(uuid,text,text,text,text,text,text,text,text);
CREATE OR REPLACE FUNCTION wacrm.claim_wa_connection(
 p_account_id uuid,p_waba_id text,p_phone_number_id text,p_business_id text,
 p_display_phone_number text,p_verified_name text,p_quality_rating text,
 p_token_ciphertext text,p_pin_ciphertext text
) RETURNS TABLE(id uuid,display_phone_number text,verified_name text,
 quality_rating text,waba_id text,status text,
 claimed_pin_ciphertext text,previous_token_ciphertext text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
 AS $$
 #variable_conflict use_column
 BEGIN
 IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'service_role only' USING ERRCODE='42501';
 END IF;
 RETURN QUERY
 INSERT INTO wacrm.wa_connections AS c
 (account_id,waba_id,phone_number_id,business_id,display_phone_number,
 verified_name,quality_rating,token_ciphertext,pin_ciphertext,status)
 VALUES (p_account_id,p_waba_id,p_phone_number_id,p_business_id,p_display_phone_number,
 p_verified_name,p_quality_rating,p_token_ciphertext,p_pin_ciphertext,'pending')
 ON CONFLICT (phone_number_id) DO UPDATE SET
 account_id=EXCLUDED.account_id,
 waba_id=CASE WHEN c.status='connected' THEN c.waba_id ELSE EXCLUDED.waba_id END,
 business_id=CASE WHEN c.status='connected' THEN c.business_id ELSE EXCLUDED.business_id END,
 display_phone_number=CASE WHEN c.status='connected' THEN c.display_phone_number ELSE EXCLUDED.display_phone_number END,
 verified_name=CASE WHEN c.status='connected' THEN c.verified_name ELSE EXCLUDED.verified_name END,
 quality_rating=CASE WHEN c.status='connected' THEN c.quality_rating ELSE EXCLUDED.quality_rating END,
 token_ciphertext=CASE WHEN c.status='connected' THEN c.token_ciphertext ELSE EXCLUDED.token_ciphertext END,
 pin_ciphertext=COALESCE(c.pin_ciphertext, EXCLUDED.pin_ciphertext),
 status=CASE WHEN c.status='connected' THEN c.status ELSE 'pending' END,
 last_error=CASE WHEN c.status='connected' THEN c.last_error ELSE NULL END,updated_at=now()
 WHERE c.account_id=EXCLUDED.account_id OR c.status='disconnected' OR c.status='error'
 OR (c.status='pending' AND c.updated_at < now() - interval '15 minutes')
 RETURNING c.id,c.display_phone_number,c.verified_name,c.quality_rating,c.waba_id,c.status,
 c.pin_ciphertext,c.token_ciphertext;
 IF NOT FOUND THEN RAISE EXCEPTION 'wa_connection_owned' USING ERRCODE='23505'; END IF;
 END $$;
REVOKE ALL ON FUNCTION wacrm.claim_wa_connection(uuid,text,text,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION wacrm.claim_wa_connection(uuid,text,text,text,text,text,text,text,text) TO service_role;
COMMIT;

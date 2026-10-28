-- ============================================================
-- rollback_wacrm_signup_invite_gate.sql
--
-- Exact inverse of wacrm_signup_invite_gate.sql:
-- restore the open ensure_chat_profile(text) from wacrm_schema.sql
-- and drop app_runtime_config. Do NOT apply without Voice sign-off.
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

DROP FUNCTION IF EXISTS wacrm.ensure_chat_profile(text, text);
DROP FUNCTION IF EXISTS wacrm.ensure_chat_profile(text);

CREATE OR REPLACE FUNCTION wacrm.ensure_chat_profile(p_full_name text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wacrm, extensions
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_account_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM wacrm.profiles p WHERE p.user_id = v_uid) THEN
    RETURN;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

  INSERT INTO wacrm.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(trim(p_full_name), ''), v_email, 'My account'), v_uid)
  RETURNING id INTO v_account_id;

  INSERT INTO wacrm.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (
    v_uid,
    COALESCE(p_full_name, ''),
    COALESCE(v_email, ''),
    v_account_id,
    'owner'
  );
END;
$$;

REVOKE ALL ON FUNCTION wacrm.ensure_chat_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wacrm.ensure_chat_profile(text) TO authenticated, service_role;

DROP TABLE IF EXISTS wacrm.app_runtime_config;

COMMIT;

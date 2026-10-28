-- ============================================================
-- rollback_wacrm_signup_invite_gate.sql
--
-- Exact inverse of wacrm_signup_invite_gate.sql:
-- restore ensure_chat_profile(text), peek_invitation, redeem_invitation
-- from wacrm_schema.sql; drop mint guard + column + config.
-- After apply: NOTIFY pgrst, 'reload schema';
-- Do NOT apply without Voice sign-off.
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

DROP TRIGGER IF EXISTS account_invitations_platform_mint_guard
  ON wacrm.account_invitations;
DROP FUNCTION IF EXISTS wacrm.tg_account_invitations_platform_mint_guard();

ALTER TABLE wacrm.account_invitations
  DROP COLUMN IF EXISTS minted_by_platform_admin;

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

CREATE OR REPLACE FUNCTION wacrm.peek_invitation(p_token_hash text) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'wacrm', 'extensions'
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name
  FROM accounts
  WHERE id = v_inv.account_id;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION wacrm.redeem_invitation(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'wacrm', 'extensions'
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

DROP TABLE IF EXISTS wacrm.app_runtime_config;

NOTIFY pgrst, 'reload schema';

COMMIT;

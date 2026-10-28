-- ============================================================
-- wacrm_signup_invite_gate.sql
--
-- Server-side invite-only gate for ensure_chat_profile.
-- Mode + allowlist live in wacrm.app_runtime_config so the DB can
-- enforce them even when callers hit the RPC / PostgREST directly
-- (app env is not visible inside Postgres).
--
-- Invite mode (signup_mode = 'invite'):
--   - Allowlisted emails → personal owner account (unchanged).
--   - Platform-minted invite token (hash) → join the inviting
--     account with the invite role atomically; mark invite
--     accepted; create NO personal account. One link → one person.
--   - Owner/admin-minted invites (minted_by_platform_admin=false)
--     do NOT pass the signup gate (admission cannot chain).
--   - Label-match path is removed.
--
-- Default when keys are missing: mode = open (no behaviour change).
--
-- Apply notes (Voice):
--   1. Run after wacrm_schema.sql. Do NOT apply without Voice sign-off.
--   2. After apply, reload PostgREST schema cache:
--        NOTIFY pgrst, 'reload schema';
--   3. Pair with rollback_wacrm_signup_invite_gate.sql.
--   4. To mint a platform invite, insert with service_role and
--      minted_by_platform_admin = true (authenticated inserts are
--      forced to false by trigger).
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

CREATE TABLE IF NOT EXISTS wacrm.app_runtime_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE wacrm.app_runtime_config IS
  'DB-readable runtime knobs (signup_mode, signup_allowlist, …). Not secrets.';

ALTER TABLE wacrm.app_runtime_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_runtime_config_deny_all ON wacrm.app_runtime_config;
CREATE POLICY app_runtime_config_deny_all ON wacrm.app_runtime_config
  USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE wacrm.app_runtime_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE wacrm.app_runtime_config TO service_role;

INSERT INTO wacrm.app_runtime_config (key, value)
VALUES ('signup_mode', 'open')
ON CONFLICT (key) DO NOTHING;

INSERT INTO wacrm.app_runtime_config (key, value)
VALUES ('signup_allowlist', '')
ON CONFLICT (key) DO NOTHING;

-- Platform-only mint flag. Token remains stored as hash only.
ALTER TABLE wacrm.account_invitations
  ADD COLUMN IF NOT EXISTS minted_by_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN wacrm.account_invitations.minted_by_platform_admin IS
  'True only for invites minted by platform admins (service_role). Owner/admin invites stay false and cannot pass invite-mode signup.';

CREATE OR REPLACE FUNCTION wacrm.tg_account_invitations_platform_mint_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Authenticated console creates always clear the flag so an account
  -- owner cannot mint invites that pass the invite-mode signup gate.
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    NEW.minted_by_platform_admin := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_invitations_platform_mint_guard
  ON wacrm.account_invitations;
CREATE TRIGGER account_invitations_platform_mint_guard
  BEFORE INSERT OR UPDATE ON wacrm.account_invitations
  FOR EACH ROW
  EXECUTE FUNCTION wacrm.tg_account_invitations_platform_mint_guard();

-- Replace ensure_chat_profile.
DROP FUNCTION IF EXISTS wacrm.ensure_chat_profile(text);
DROP FUNCTION IF EXISTS wacrm.ensure_chat_profile(text, text);

CREATE OR REPLACE FUNCTION wacrm.ensure_chat_profile(
  p_full_name text DEFAULT '',
  p_invite_token_hash text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wacrm, extensions
AS $$
DECLARE
  v_uid uuid;
  v_email text;
  v_account_id uuid;
  v_mode text;
  v_allowlist text;
  v_email_l text;
  v_domain text;
  v_item text;
  v_allowlisted boolean := false;
  v_inv wacrm.account_invitations%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM wacrm.profiles p WHERE p.user_id = v_uid) THEN
    RETURN;
  END IF;

  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
  v_email_l := lower(trim(coalesce(v_email, '')));

  SELECT lower(trim(c.value)) INTO v_mode
  FROM wacrm.app_runtime_config c
  WHERE c.key = 'signup_mode';
  IF v_mode IS NULL OR v_mode = '' THEN
    v_mode := 'open';
  END IF;

  IF v_mode = 'open' THEN
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
    RETURN;
  END IF;

  -- invite mode -------------------------------------------------------
  -- 1) Allowlist → personal owner account (same as open for allowlisted).
  SELECT c.value INTO v_allowlist
  FROM wacrm.app_runtime_config c
  WHERE c.key = 'signup_allowlist';
  v_allowlist := coalesce(v_allowlist, '');
  v_domain := split_part(v_email_l, '@', 2);

  FOR v_item IN
    SELECT trim(both FROM x)
    FROM unnest(string_to_array(v_allowlist, ',')) AS x
  LOOP
    IF v_item = '' THEN
      CONTINUE;
    END IF;
    v_item := lower(v_item);
    IF left(v_item, 1) = '@' THEN
      IF v_domain <> '' AND v_domain = substr(v_item, 2) THEN
        v_allowlisted := true;
        EXIT;
      END IF;
    ELSIF position('@' IN v_item) > 0 THEN
      IF v_email_l <> '' AND v_email_l = v_item THEN
        v_allowlisted := true;
        EXIT;
      END IF;
    ELSE
      IF v_domain <> '' AND v_domain = v_item THEN
        v_allowlisted := true;
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF v_allowlisted THEN
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
    RETURN;
  END IF;

  -- 2) Platform-minted invite token → atomic join (no personal account).
  IF p_invite_token_hash IS NULL OR length(trim(p_invite_token_hash)) = 0 THEN
    RAISE EXCEPTION 'invite_only'
      USING ERRCODE = '42501',
            HINT = 'Chat signup is invite-only; use a platform invite link or ask an admin.';
  END IF;

  SELECT * INTO v_inv
  FROM wacrm.account_invitations i
  WHERE i.token_hash = trim(p_invite_token_hash)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_only'
      USING ERRCODE = '42501',
            HINT = 'Invitation not found.';
  END IF;

  IF v_inv.minted_by_platform_admin IS NOT TRUE THEN
    -- Owner/admin-minted invites must not admit new Chat users.
    RAISE EXCEPTION 'invite_only'
      USING ERRCODE = '42501',
            HINT = 'Only platform-minted invites can admit new users.';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_only'
      USING ERRCODE = '42501',
            HINT = 'Invitation has already been redeemed.';
  END IF;

  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_only'
      USING ERRCODE = '42501',
            HINT = 'Invitation has expired.';
  END IF;

  -- Join inviting account with invite role — no personal account row.
  INSERT INTO wacrm.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (
    v_uid,
    COALESCE(p_full_name, ''),
    COALESCE(v_email, ''),
    v_inv.account_id,
    v_inv.role
  );

  UPDATE wacrm.account_invitations
  SET accepted_at = now(),
      accepted_by_user_id = v_uid
  WHERE id = v_inv.id
    AND accepted_at IS NULL;

  IF NOT FOUND THEN
    -- Lost a race with another redeemer.
    RAISE EXCEPTION 'invite_only'
      USING ERRCODE = '42501',
            HINT = 'Invitation has already been redeemed.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION wacrm.ensure_chat_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wacrm.ensure_chat_profile(text, text) TO authenticated, service_role;

-- peek: if this caller already accepted (ensure path), treat as ok.
CREATE OR REPLACE FUNCTION wacrm.peek_invitation(p_token_hash text) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'wacrm', 'extensions'
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    IF v_uid IS NOT NULL AND v_inv.accepted_by_user_id = v_uid THEN
      SELECT name INTO v_account_name FROM accounts WHERE id = v_inv.account_id;
      RETURN json_build_object(
        'ok', true,
        'account_name', v_account_name,
        'role', v_inv.role,
        'expires_at', v_inv.expires_at,
        'already_joined', true
      );
    END IF;
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

-- Idempotent redeem when this user already accepted (ensure path).
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

  -- Already accepted by this caller (e.g. ensure_chat_profile did it).
  IF v_inv.accepted_at IS NOT NULL THEN
    IF v_inv.accepted_by_user_id = v_caller_id THEN
      RETURN v_inv.account_id;
    END IF;
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
    -- Already on the target account (ensure path for platform invites).
    UPDATE account_invitations
    SET accepted_at = NOW(),
        accepted_by_user_id = v_caller_id
    WHERE id = v_inv.id AND accepted_at IS NULL;
    RETURN v_inv.account_id;
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

-- PostgREST must reload so ensure_chat_profile(text, text) is exposed.
NOTIFY pgrst, 'reload schema';

COMMIT;

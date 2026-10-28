-- ============================================================
-- wacrm_signup_invite_gate.sql
--
-- Server-side invite-only gate for ensure_chat_profile.
-- Mode + allowlist live in wacrm.app_runtime_config so the DB can
-- enforce them even when callers hit the RPC / PostgREST directly
-- (app env is not visible inside Postgres).
--
-- Default when keys are missing: mode = open (no behaviour change).
--
-- CREATE OR REPLACE of ensure_chat_profile adds optional
-- p_invite_token_hash so /join users can bootstrap a personal
-- profile before redeem_invitation. Voice reviews before apply.
-- Pair with rollback_wacrm_signup_invite_gate.sql.
-- Do NOT apply from Chat agents without Voice sign-off.
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
-- SECURITY DEFINER ensure_chat_profile reads this table as owner.

-- Seed defaults only when absent (open = current behaviour).
INSERT INTO wacrm.app_runtime_config (key, value)
VALUES ('signup_mode', 'open')
ON CONFLICT (key) DO NOTHING;

INSERT INTO wacrm.app_runtime_config (key, value)
VALUES ('signup_allowlist', '')
ON CONFLICT (key) DO NOTHING;

-- Replace ensure_chat_profile: drop 1-arg form, create 2-arg with defaults.
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
  v_allowed boolean := false;
  v_item text;
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

  IF v_mode = 'invite' THEN
    -- 1) Valid pending invite token (hash), for /join bootstrap.
    IF p_invite_token_hash IS NOT NULL AND length(trim(p_invite_token_hash)) > 0 THEN
      IF EXISTS (
        SELECT 1
        FROM wacrm.account_invitations i
        WHERE i.token_hash = trim(p_invite_token_hash)
          AND i.accepted_at IS NULL
          AND i.expires_at > now()
      ) THEN
        v_allowed := true;
      END IF;
    END IF;

    -- 2) Allowlist: exact emails and @domains (comma-separated).
    IF NOT v_allowed THEN
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
            v_allowed := true;
            EXIT;
          END IF;
        ELSIF position('@' IN v_item) > 0 THEN
          IF v_email_l <> '' AND v_email_l = v_item THEN
            v_allowed := true;
            EXIT;
          END IF;
        ELSE
          -- bare domain without leading @
          IF v_domain <> '' AND v_domain = v_item THEN
            v_allowed := true;
            EXIT;
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 3) Soft: pending invitation label matches email.
    IF NOT v_allowed AND v_email_l <> '' THEN
      IF EXISTS (
        SELECT 1
        FROM wacrm.account_invitations i
        WHERE i.accepted_at IS NULL
          AND i.expires_at > now()
          AND lower(trim(i.label)) = v_email_l
      ) THEN
        v_allowed := true;
      END IF;
    END IF;

    IF NOT v_allowed THEN
      RAISE EXCEPTION 'invite_only'
        USING ERRCODE = '42501',
              HINT = 'Chat signup is invite-only; use an invite link or ask an admin.';
    END IF;
  END IF;

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

REVOKE ALL ON FUNCTION wacrm.ensure_chat_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wacrm.ensure_chat_profile(text, text) TO authenticated, service_role;

COMMIT;

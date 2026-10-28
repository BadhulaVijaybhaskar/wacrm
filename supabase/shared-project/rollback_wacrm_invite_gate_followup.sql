-- ============================================================
-- rollback_wacrm_invite_gate_followup.sql
--
-- Exact inverse of wacrm_invite_gate_followup.sql:
-- restore tg_account_invitations_platform_mint_guard without a
-- pinned search_path (as applied by wacrm_signup_invite_gate.sql).
--
-- Does NOT touch redeem_invitation — the invite-gate body stays.
-- For a full invite-gate undo, use rollback_wacrm_signup_invite_gate.sql
-- (its redeem_invitation now matches the exact live definition from
-- wacrm_schema.sql).
--
-- Do NOT apply without Voice sign-off.
-- After apply: NOTIFY pgrst, 'reload schema';
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

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

NOTIFY pgrst, 'reload schema';

COMMIT;

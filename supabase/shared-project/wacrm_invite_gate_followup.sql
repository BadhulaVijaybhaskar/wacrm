-- ============================================================
-- wacrm_invite_gate_followup.sql
--
-- Follow-up to wacrm_signup_invite_gate.sql (already applied).
-- Do NOT edit the applied pack files; this additive migration:
--   1. Pins search_path on tg_account_invitations_platform_mint_guard
--      (the applied definition had none).
--
-- Companion rollback restores the unpinned guard only.
-- Full invite-gate undo: rollback_wacrm_signup_invite_gate.sql
-- (redeem_invitation there matches exact live from wacrm_schema.sql).
--
-- Do NOT apply without Voice sign-off.
-- After apply: NOTIFY pgrst, 'reload schema';
-- ============================================================

BEGIN;
SET LOCAL search_path = wacrm, extensions;

CREATE OR REPLACE FUNCTION wacrm.tg_account_invitations_platform_mint_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'wacrm', 'extensions'
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

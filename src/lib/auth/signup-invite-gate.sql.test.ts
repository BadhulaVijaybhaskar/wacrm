/**
 * Static contract checks for wacrm_signup_invite_gate.sql
 * (Voice review pack — not applied). Covers the behaviours that
 * require a live DB to execute, asserted here as source requirements.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sqlPath = resolve(
  process.cwd(),
  'supabase/shared-project/wacrm_signup_invite_gate.sql',
)
const rollbackPath = resolve(
  process.cwd(),
  'supabase/shared-project/rollback_wacrm_signup_invite_gate.sql',
)

describe('wacrm_signup_invite_gate.sql contract', () => {
  const sql = readFileSync(sqlPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')

  it('requires NOTIFY pgrst reload schema on apply and rollback', () => {
    expect(sql).toMatch(/NOTIFY pgrst,\s*'reload schema'/i)
    expect(rollback).toMatch(/NOTIFY pgrst,\s*'reload schema'/i)
  })

  it('gates on minted_by_platform_admin (owner-minted invites rejected)', () => {
    expect(sql).toMatch(/minted_by_platform_admin/)
    expect(sql).toMatch(/Only platform-minted invites can admit new users/)
    expect(sql).toMatch(/tg_account_invitations_platform_mint_guard/)
  })

  it('atomically joins inviting account with no personal accounts insert on invite path', () => {
    // Invite-token branch inserts profiles against v_inv.account_id only.
    expect(sql).toMatch(
      /INSERT INTO wacrm\.profiles[\s\S]*v_inv\.account_id[\s\S]*v_inv\.role/,
    )
    expect(sql).toMatch(
      /UPDATE wacrm\.account_invitations[\s\S]*accepted_at = now\(\)/,
    )
    // Label-match admission must be gone.
    expect(sql).not.toMatch(/lower\(trim\(i\.label\)\)/)
    expect(sql).not.toMatch(/pending_invite/)
  })

  it('marks invite accepted so a second redeem is rejected', () => {
    expect(sql).toMatch(/accepted_by_user_id = v_uid/)
    expect(sql).toMatch(/Invitation has already been redeemed/)
  })

  it('stores invite tokens as hash only (p_invite_token_hash)', () => {
    expect(sql).toMatch(/p_invite_token_hash/)
    expect(sql).toMatch(/i\.token_hash = trim\(p_invite_token_hash\)/)
  })

  it('rollback drops config + column and restores 1-arg ensure_chat_profile', () => {
    expect(rollback).toMatch(/DROP TABLE IF EXISTS wacrm\.app_runtime_config/)
    expect(rollback).toMatch(
      /DROP COLUMN IF EXISTS minted_by_platform_admin/,
    )
    expect(rollback).toMatch(
      /ensure_chat_profile\(p_full_name text DEFAULT ''\)/,
    )
  })
})

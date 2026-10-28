/**
 * Platform-admin invite minting (invite-mode onboarding).
 *
 * Owner/admin console invites (`POST /api/account/invitations`) always
 * land with `minted_by_platform_admin = false` (trigger forces it for
 * non-service_role). Those links cannot admit new Chat users when
 * `signup_mode=invite`. Only rows inserted via the service role with
 * `minted_by_platform_admin = true` pass the gate.
 *
 * Callers: `POST /api/platform/invitations` (Bearer service role or
 * PLATFORM_ADMIN_SECRET) or any script that uses createServiceClient().
 */

import { timingSafeEqual } from 'node:crypto'

import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from '@/lib/auth/invitations'
import { isAccountRole, type AccountRole } from '@/lib/auth/roles'

export type PlatformInviteDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export type MintPlatformInviteInput = {
  accountId: string
  role: AccountRole
  label?: string | null
  expiresInDays?: number
  /** Optional creator stamp; null for pure service-role mints. */
  createdByUserId?: string | null
  baseUrl: string
  now?: Date
}

export type MintPlatformInviteResult =
  | {
      ok: true
      invitation: {
        id: string
        account_id: string
        role: string
        label: string | null
        expires_at: string
        created_at: string
        minted_by_platform_admin: boolean
      }
      token: string
      url: string
      expiresInDays: number
    }
  | { ok: false; status: 400 | 404 | 500; error: string }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** Constant-time equality for bearer / shared-secret headers. */
export function secretsEqual(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Authorize a platform-mint request. Accepts either the Supabase
 * service-role key or PLATFORM_ADMIN_SECRET as `Authorization: Bearer …`
 * (or the same value in `x-platform-admin-secret`).
 */
export function authorizePlatformMint(args: {
  authorizationHeader: string | null
  platformAdminSecretHeader: string | null
  serviceRoleKey: string | undefined
  platformAdminSecret: string | undefined
}): boolean {
  const bearer = args.authorizationHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const headerSecret = args.platformAdminSecretHeader?.trim() || ''
  const candidates = [bearer, headerSecret].filter(Boolean) as string[]
  if (candidates.length === 0) return false

  const expected: string[] = []
  if (args.serviceRoleKey?.trim()) expected.push(args.serviceRoleKey.trim())
  if (args.platformAdminSecret?.trim()) {
    expected.push(args.platformAdminSecret.trim())
  }
  if (expected.length === 0) return false

  return candidates.some((got) => expected.some((want) => secretsEqual(got, want)))
}

export async function mintPlatformInvite(
  db: PlatformInviteDb,
  input: MintPlatformInviteInput,
): Promise<MintPlatformInviteResult> {
  if (!isUuid(input.accountId)) {
    return { ok: false, status: 400, error: 'account_id must be a UUID' }
  }
  if (!isAccountRole(input.role) || input.role === 'owner') {
    return {
      ok: false,
      status: 400,
      error: "'role' must be one of admin, agent, viewer",
    }
  }

  const { data: account, error: accountErr } = await db
    .from('accounts')
    .select('id')
    .eq('id', input.accountId)
    .maybeSingle()
  if (accountErr) {
    console.error('[platform-invite] account lookup failed:', accountErr)
    return { ok: false, status: 500, error: 'Failed to look up account' }
  }
  if (!account) {
    return { ok: false, status: 404, error: 'Account not found' }
  }

  let label: string | null = null
  if (typeof input.label === 'string') {
    const trimmed = input.label.trim()
    if (trimmed.length > 80) {
      return {
        ok: false,
        status: 400,
        error: 'Label must be 80 characters or fewer',
      }
    }
    label = trimmed === '' ? null : trimmed
  }

  const expiryDays = clampExpiryDays(input.expiresInDays)
  const expiresAt = inviteExpiresAt(expiryDays, input.now ?? new Date())
  const { token, hash } = generateInviteToken()

  const { data, error } = await db
    .from('account_invitations')
    .insert({
      account_id: input.accountId,
      token_hash: hash,
      role: input.role,
      created_by_user_id: input.createdByUserId ?? null,
      label,
      expires_at: expiresAt.toISOString(),
      minted_by_platform_admin: true,
    })
    .select(
      'id, account_id, role, label, expires_at, created_at, minted_by_platform_admin',
    )
    .single()

  if (error || !data) {
    console.error('[platform-invite] insert failed:', error)
    return { ok: false, status: 500, error: 'Failed to create invitation' }
  }

  return {
    ok: true,
    invitation: data,
    token,
    url: inviteUrl(token, input.baseUrl),
    expiresInDays: expiryDays,
  }
}

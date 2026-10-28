/**
 * Invite / allowlist gate for Chat account provisioning.
 *
 * WACRM_SIGNUP_MODE=open|invite (default open — unchanged behaviour).
 * When `invite`, a user only gets a Chat profile/account if:
 *   - their email is on WACRM_SIGNUP_ALLOWLIST (comma-separated emails
 *     or @domains), or
 *   - they carry a platform invite token (signup?invite= / /join/<token>).
 *
 * Label-match admission is removed — invites must be token-based.
 * DB pack (wacrm_signup_invite_gate.sql) additionally requires
 * minted_by_platform_admin and redeems atomically with no personal account.
 */

export type SignupMode = 'open' | 'invite'

export function getSignupMode(
  env: NodeJS.ProcessEnv = process.env,
): SignupMode {
  const raw = env.WACRM_SIGNUP_MODE?.trim().toLowerCase()
  return raw === 'invite' ? 'invite' : 'open'
}

/** Parse `a@x.com, @company.com, person@y.org` → emails + domains. */
export function parseSignupAllowlist(
  raw: string | undefined | null,
): { emails: Set<string>; domains: Set<string> } {
  const emails = new Set<string>()
  const domains = new Set<string>()
  if (!raw?.trim()) return { emails, domains }
  for (const part of raw.split(',')) {
    const item = part.trim().toLowerCase()
    if (!item) continue
    if (item.startsWith('@') && item.length > 1) {
      domains.add(item.slice(1))
      continue
    }
    if (item.includes('@')) {
      emails.add(item)
      continue
    }
    domains.add(item)
  }
  return { emails, domains }
}

export function isEmailAllowlisted(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const trimmed = (email ?? '').trim().toLowerCase()
  if (!trimmed || !trimmed.includes('@')) return false
  const { emails, domains } = parseSignupAllowlist(
    env.WACRM_SIGNUP_ALLOWLIST,
  )
  if (emails.has(trimmed)) return true
  const domain = trimmed.split('@')[1] ?? ''
  return domain.length > 0 && domains.has(domain)
}

/**
 * Whether this identity may receive a Chat profile via ensure_chat_profile.
 */
export function mayProvisionChatProfile(args: {
  email?: string | null
  /** Present when the user is on an invite / join flow. */
  hasInviteToken?: boolean
  env?: NodeJS.ProcessEnv
}): { allowed: boolean; mode: SignupMode; reason?: string } {
  const env = args.env ?? process.env
  const mode = getSignupMode(env)
  if (mode === 'open') {
    return { allowed: true, mode }
  }

  if (args.hasInviteToken) {
    return { allowed: true, mode, reason: 'invite_token' }
  }
  if (isEmailAllowlisted(args.email, env)) {
    return { allowed: true, mode, reason: 'allowlist' }
  }

  return {
    allowed: false,
    mode,
    reason: 'invite_only',
  }
}

/**
 * Owner auto-provision / ensure_chat_profile may run when:
 * - open mode
 * - allowlisted (personal owner account)
 * - invite token present (DB joins inviting account; no personal account)
 */
export function mayAutoCreateOwnerAccount(args: {
  email?: string | null
  hasInviteToken?: boolean
  env?: NodeJS.ProcessEnv
}): { allowed: boolean; mode: SignupMode; reason?: string } {
  const env = args.env ?? process.env
  const mode = getSignupMode(env)
  if (mode === 'open') {
    return { allowed: true, mode }
  }
  if (isEmailAllowlisted(args.email, env)) {
    return { allowed: true, mode, reason: 'allowlist' }
  }
  if (args.hasInviteToken) {
    return { allowed: true, mode, reason: 'invite_token_bootstrap' }
  }
  return { allowed: false, mode, reason: 'invite_only' }
}

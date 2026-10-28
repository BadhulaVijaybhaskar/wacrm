import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import {
  getSignupMode,
  isEmailAllowlisted,
  mayAutoCreateOwnerAccount,
  mayProvisionChatProfile,
} from '@/lib/auth/signup-gate'

/**
 * GET /api/auth/signup-access
 *
 * Returns whether the current session (or ?email=) may sign up / receive
 * a Chat profile under WACRM_SIGNUP_MODE. Does not expose the allowlist.
 *
 * Query:
 *   email — optional; when signed out (signup page) pass the typed email
 *   invite — optional invite token presence flag (`1`)
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const inviteFlag = url.searchParams.get('invite')
  const hasInviteToken =
    inviteFlag === '1' || inviteFlag === 'true' || Boolean(inviteFlag?.trim())

  const mode = getSignupMode()

  let email =
    (url.searchParams.get('email') ?? '').trim().toLowerCase() || null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.email) {
    email = user.email.trim().toLowerCase()
  }

  let hasPendingInviteLabel = false
  if (email && mode === 'invite') {
    try {
      const admin = createServiceClient()
      const { data } = await admin
        .from('account_invitations')
        .select('id')
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .ilike('label', email)
        .limit(1)
      hasPendingInviteLabel = Boolean(data && data.length > 0)
    } catch {
      // Admin client may be unavailable in some test envs — treat as no match.
      hasPendingInviteLabel = false
    }
  }

  const provision = mayProvisionChatProfile({
    email,
    hasInviteToken,
    hasPendingInviteLabel,
  })
  const owner = mayAutoCreateOwnerAccount({
    email,
    hasPendingInviteLabel,
  })

  return NextResponse.json({
    mode,
    email: email ? email.replace(/(^.).*(@.*$)/, '$1***$2') : null,
    allowlisted: email ? isEmailAllowlisted(email) : false,
    has_pending_invite_label: hasPendingInviteLabel,
    may_signup: provision.allowed,
    may_auto_create_owner: owner.allowed,
    reason: owner.allowed
      ? owner.reason ?? null
      : provision.allowed
        ? provision.reason ?? null
        : 'invite_only',
  })
}

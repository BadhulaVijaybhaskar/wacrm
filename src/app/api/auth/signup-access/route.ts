import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
 *   invite — optional invite token (`1`/`true` = presence flag, or the
 *            real token from /join/<token> / signup?invite=)
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const inviteParam = (url.searchParams.get('invite') ?? '').trim()
  const hasInviteToken =
    inviteParam === '1' ||
    inviteParam === 'true' ||
    (inviteParam.length > 0 &&
      inviteParam !== '0' &&
      inviteParam !== 'false')

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

  const provision = mayProvisionChatProfile({
    email,
    hasInviteToken,
  })
  const owner = mayAutoCreateOwnerAccount({
    email,
    hasInviteToken,
  })

  return NextResponse.json({
    mode,
    email: email ? email.replace(/(^.).*(@.*$)/, '$1***$2') : null,
    allowlisted: email ? isEmailAllowlisted(email) : false,
    has_invite_token: hasInviteToken,
    may_signup: provision.allowed,
    may_auto_create_owner: owner.allowed,
    reason: owner.allowed
      ? owner.reason ?? null
      : provision.allowed
        ? provision.reason ?? null
        : 'invite_only',
  })
}

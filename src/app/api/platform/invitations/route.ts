/**
 * POST /api/platform/invitations
 *
 * Service-role / platform-admin mint for invite-mode onboarding.
 * Inserts `account_invitations` with `minted_by_platform_admin = true`
 * so `ensure_chat_profile(..., p_invite_token_hash)` will admit the
 * redeemer. Owner/admin console invites cannot do this.
 *
 * Auth (any one):
 *   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   Authorization: Bearer <PLATFORM_ADMIN_SECRET>
 *   x-platform-admin-secret: <PLATFORM_ADMIN_SECRET>
 *
 * Body: { account_id, role, label?, expiresInDays? }
 */

import { NextResponse } from 'next/server'

import {
  authorizePlatformMint,
  mintPlatformInvite,
} from '@/lib/auth/platform-invite'
import { createServiceClient } from '@/lib/supabase/admin'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`
  }
  const host = request.headers.get('host')?.trim()
  if (host) {
    const proto = new URL(request.url).protocol.replace(':', '')
    return `${proto}://${host}`
  }
  return 'https://wa.astraconnect.io'
}

export async function POST(request: Request) {
  const allowed = authorizePlatformMint({
    authorizationHeader: request.headers.get('authorization'),
    platformAdminSecretHeader: request.headers.get('x-platform-admin-secret'),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    platformAdminSecret: process.env.PLATFORM_ADMIN_SECRET,
  })
  if (!allowed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = checkRateLimit(
    'platform:inviteMint',
    RATE_LIMITS.adminAction,
  )
  if (!limit.success) return rateLimitResponse(limit)

  const body = (await request.json().catch(() => null)) as
    | {
        account_id?: unknown
        role?: unknown
        label?: unknown
        expiresInDays?: unknown
        created_by_user_id?: unknown
      }
    | null

  if (!body || typeof body.account_id !== 'string') {
    return NextResponse.json(
      { error: 'account_id (UUID) is required' },
      { status: 400 },
    )
  }
  if (typeof body.role !== 'string') {
    return NextResponse.json(
      { error: "'role' must be one of admin, agent, viewer" },
      { status: 400 },
    )
  }

  const expiresInDays =
    typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined
  const label = typeof body.label === 'string' ? body.label : null
  const createdByUserId =
    typeof body.created_by_user_id === 'string'
      ? body.created_by_user_id
      : null

  const db = createServiceClient()
  const result = await mintPlatformInvite(db, {
    accountId: body.account_id,
    // validated inside mintPlatformInvite
    role: body.role as 'admin' | 'agent' | 'viewer',
    label,
    expiresInDays,
    createdByUserId,
    baseUrl: getBaseUrl(request),
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(
    {
      invitation: result.invitation,
      token: result.token,
      url: result.url,
      expiresInDays: result.expiresInDays,
    },
    { status: 201 },
  )
}

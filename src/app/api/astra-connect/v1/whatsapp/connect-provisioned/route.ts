import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  isUpstreamUnavailable,
  upstreamUnavailableResponse,
} from '@/lib/astra-connect/read-auth'
import {
  applyConnectProvisioned,
  isConnectProvisionedEnabled,
  parseConnectProvisionedBody,
} from '@/lib/astra-connect/connect-provisioned'

/**
 * POST /api/astra-connect/v1/whatsapp/connect-provisioned
 *
 * Draft, flag-gated (§15). Off by default (`WACRM_CONNECT_PROVISIONED=0`
 * / unset → 404). When on: Connect pushes a Meta Cloud API token that
 * Chat stores under whatsapp_config without calling Meta /register or
 * /subscribed_apps.
 *
 * Auth: §13 HMAC over `${rawBody}.${tenant_id}` (same as other Connect
 * POSTs). X-Astra-Tenant must equal body.tenant_id; kind must be
 * `whatsapp.connect_provisioned`.
 */
export async function POST(request: Request) {
  if (!isConnectProvisionedEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  let parsedJson: unknown
  try {
    parsedJson = rawBody ? JSON.parse(rawBody) : null
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = parseConnectProvisionedBody(parsedJson)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const auth = await authenticateConnectRequest({
      request,
      tenantId: parsed.body.tenant_id,
      rawBody,
      rateLimit: 'none',
    })
    if (!auth.ok) return auth.response

    const secret =
      process.env.WACRM_ADAPTER_SECRET?.trim() &&
      process.env.WACRM_ADAPTER_SECRET.trim().length >= 16
        ? process.env.WACRM_ADAPTER_SECRET.trim()
        : null
    if (!secret) {
      return NextResponse.json(
        { error: 'Adapter secret not configured' },
        { status: 503 },
      )
    }

    const { data: account, error: accountErr } = await auth.ctx.db
      .from('accounts')
      .select('id, owner_user_id')
      .eq('id', auth.ctx.accountId)
      .maybeSingle()

    if (accountErr || !account?.owner_user_id) {
      return NextResponse.json(
        { error: 'Account owner unavailable' },
        { status: 404 },
      )
    }

    const result = await applyConnectProvisioned({
      db: auth.ctx.db,
      accountId: auth.ctx.accountId,
      body: parsed.body,
      adapterSecret: secret,
      ownerUserId: account.owner_user_id as string,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      )
    }

    return NextResponse.json({
      ok: true,
      config_id: result.config_id,
      phone_number_id: result.phone_number_id,
    })
  } catch (err) {
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    console.error(
      '[connect-provisioned]',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

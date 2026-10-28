import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  isUpstreamUnavailable,
  upstreamUnavailableResponse,
} from '@/lib/astra-connect/read-auth'
import {
  isAfterCallTemplatesEnabled,
  listApprovedTemplates,
} from '@/lib/astra-connect/after-call-templates'

/**
 * GET /api/astra-connect/v1/whatsapp/templates
 *
 * Connect §16 — list APPROVED templates for the tenant's
 * phone_number_id / WABA. Flag-gated (`WACRM_AFTER_CALL_TEMPLATES`,
 * default off → 404).
 *
 * Query: tenant_id, phone_number_id (both required).
 * Auth: §13 HMAC over `${pathname}${search}.${tenant}`.
 * Cross-tenant phone → 404.
 */
export async function GET(request: Request) {
  if (!isAfterCallTemplatesEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenant_id') ?? '').trim()
  const phoneNumberId = (url.searchParams.get('phone_number_id') ?? '').trim()

  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenant_id is required', code: 'missing_tenant' },
      { status: 400 },
    )
  }
  if (!phoneNumberId) {
    return NextResponse.json(
      {
        error: 'phone_number_id is required',
        code: 'missing_phone_number_id',
      },
      { status: 400 },
    )
  }
  if (!/^\d+$/.test(phoneNumberId)) {
    return NextResponse.json(
      {
        error: 'phone_number_id must contain only digits',
        code: 'bad_phone_number_id',
      },
      { status: 400 },
    )
  }

  try {
    const auth = await authenticateConnectRequest({
      request,
      tenantId,
      rawBody: '',
      rateLimit: 'read',
    })
    if (!auth.ok) return auth.response

    const result = await listApprovedTemplates({
      db: auth.ctx.db,
      accountId: auth.ctx.accountId,
      tenantId,
      phoneNumberId,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      )
    }

    return NextResponse.json({
      templates: result.templates,
      phone_number_id: result.phone_number_id,
      waba_id: result.waba_id,
    })
  } catch (err) {
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    console.error(
      '[after-call/templates]',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

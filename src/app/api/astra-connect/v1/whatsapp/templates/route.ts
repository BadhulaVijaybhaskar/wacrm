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
 * Connect §16.1 — list APPROVED templates for the tenant's
 * phone_number_id / WABA. Flag-gated (`WACRM_AFTER_CALL_TEMPLATES`,
 * default off → 404).
 *
 * Query: tenant_id, phone_number_id (required); waba_id, status
 * (optional; status defaults to APPROVED filtering server-side).
 * Auth: §16 → §2 + X-Astra-Tenant (Chat: path+query.tenant).
 */
export async function GET(request: Request) {
  if (!isAfterCallTemplatesEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenant_id') ?? '').trim()
  const phoneNumberId = (url.searchParams.get('phone_number_id') ?? '').trim()

  if (!tenantId) {
    return NextResponse.json({ error: 'missing_tenant' }, { status: 400 })
  }
  if (!phoneNumberId) {
    return NextResponse.json(
      { error: 'missing_phone_number_id' },
      { status: 400 },
    )
  }
  if (!/^\d+$/.test(phoneNumberId)) {
    return NextResponse.json(
      { error: 'bad_phone_number_id' },
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
        { error: result.error },
        { status: result.status },
      )
    }

    // §16.1 response: { templates: [{ name, language, status, category,
    // body_text, variable_count }] }
    return NextResponse.json({
      templates: result.templates.map((t) => ({
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
        body_text: t.body_text,
        variable_count: t.variable_count,
      })),
    })
  } catch (err) {
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    console.error(
      '[after-call/templates]',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

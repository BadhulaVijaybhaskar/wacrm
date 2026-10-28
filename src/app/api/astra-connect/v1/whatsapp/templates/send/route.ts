import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  isUpstreamUnavailable,
  upstreamUnavailableResponse,
} from '@/lib/astra-connect/read-auth'
import {
  isAfterCallTemplatesEnabled,
  parseAfterCallSendBody,
  sendAfterCallTemplate,
} from '@/lib/astra-connect/after-call-templates'

/**
 * POST /api/astra-connect/v1/whatsapp/templates/send
 *
 * Connect §16 after-call template send. Flag-gated
 * (`WACRM_AFTER_CALL_TEMPLATES`, default off → 404).
 *
 * Auth: §13 HMAC over `${rawBody}.${tenant_id}`. X-Astra-Tenant must
 * equal body.tenant_id. Tenant may only send via its own
 * phone_number_id (mismatch → 404).
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN / META_STUB is on, Meta is not called
 * and a dry-run message_id is returned. Idempotent on request_id.
 */
export async function POST(request: Request) {
  if (!isAfterCallTemplatesEnabled()) {
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

  const parsed = parseAfterCallSendBody(parsedJson)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, code: parsed.code },
      { status: 400 },
    )
  }

  try {
    const auth = await authenticateConnectRequest({
      request,
      tenantId: parsed.body.tenant_id,
      rawBody,
      rateLimit: 'none',
    })
    if (!auth.ok) return auth.response

    const result = await sendAfterCallTemplate({
      db: auth.ctx.db,
      accountId: auth.ctx.accountId,
      body: parsed.body,
    })

    if (!result.ok) {
      const headers: Record<string, string> = {}
      if (result.retry_after != null) {
        headers['Retry-After'] = String(result.retry_after)
      }
      return NextResponse.json(
        {
          error: result.error,
          code: result.code,
          meta: result.meta,
        },
        { status: result.status, headers },
      )
    }

    return NextResponse.json({
      ok: true,
      message_id: result.message_id,
      request_id: result.request_id,
      dry_run: result.dry_run,
      replay: result.replay,
    })
  } catch (err) {
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    console.error(
      '[after-call/templates/send]',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  isUpstreamUnavailable,
  readAstraTenantHeader,
  upstreamUnavailableResponse,
} from '@/lib/astra-connect/read-auth'
import {
  isAfterCallTemplatesEnabled,
  parseAfterCallIdempotencyKey,
  parseAfterCallSendBody,
  sendAfterCallMessage,
} from '@/lib/astra-connect/after-call-templates'

/**
 * POST /api/astra-connect/v1/whatsapp/send
 *
 * Connect §16.2 after-call WhatsApp send. Flag-gated
 * (`WACRM_AFTER_CALL_TEMPLATES`, default off → 404).
 *
 * Auth order: HMAC + tenant are verified on the raw body **before**
 * JSON parse / field validation, so unsigned callers get 401 (never
 * a 400 validation code).
 *
 * Idempotency-Key: after-call:<call_id>[:template], durable in
 * astra_after_call_sends (pending reservation → final / release).
 */
export async function POST(request: Request) {
  if (!isAfterCallTemplatesEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    // Still unauthenticated — prefer 401 over leaking parse errors.
    return NextResponse.json(
      { error: 'signature_required' },
      { status: 401 },
    )
  }

  const headerTenant = readAstraTenantHeader(request)
  if (!headerTenant) {
    // Missing tenant is structural for Connect v1; authenticateConnectRequest
    // returns 400. Keep that for signed-header shape, but if signature is
    // also missing the auth helper returns 401 first for sig headers.
    // Call authenticate with empty tenantId so it still runs header checks.
  }

  try {
    // Auth first on raw bytes + X-Astra-Tenant (before body validation).
    const auth = await authenticateConnectRequest({
      request,
      tenantId: headerTenant ?? '',
      rawBody,
      rateLimit: 'none',
    })
    if (!auth.ok) return auth.response

    let parsedJson: unknown
    try {
      parsedJson = rawBody ? JSON.parse(rawBody) : null
    } catch {
      return NextResponse.json({ error: 'bad_json' }, { status: 400 })
    }

    const parsed = parseAfterCallSendBody(parsedJson)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    if (parsed.body.tenant_id !== auth.ctx.tenantId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const idemHeader =
      request.headers.get('idempotency-key') ??
      request.headers.get('Idempotency-Key')
    const idem = parseAfterCallIdempotencyKey(
      idemHeader,
      parsed.body.call_id,
    )
    if (!idem.ok) {
      return NextResponse.json({ error: idem.error }, { status: 400 })
    }

    const result = await sendAfterCallMessage({
      db: auth.ctx.db,
      accountId: auth.ctx.accountId,
      body: parsed.body,
      idempotencyKey: idem.key,
    })

    if (!result.ok) {
      const headers: Record<string, string> = {}
      if (result.retry_after != null) {
        headers['Retry-After'] = String(result.retry_after)
      }
      return NextResponse.json(result.body, {
        status: result.status,
        headers,
      })
    }

    return NextResponse.json(result.body, { status: 200 })
  } catch (err) {
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    console.error(
      '[after-call/whatsapp/send]',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

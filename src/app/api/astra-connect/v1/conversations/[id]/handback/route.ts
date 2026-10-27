import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  isUpstreamUnavailable,
  upstreamUnavailableResponse,
} from '@/lib/astra-connect/read-auth'
import { setConversationHandoff } from '@/lib/astra-connect/read-api'
import {
  handbackBodySchema,
  zodErrorMessage,
} from '@/lib/astra-connect/read-schemas'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/astra-connect/v1/conversations/:id/handback
 * Body: { tenant_id, by? }
 * Sets handoff=ai (AI resumes). Idempotent.
 * Auth order: zod 400 → timestamp 401 → HMAC → DB.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id: conversationId } = await params
    const rawBody = await request.text()
    let json: unknown
    try {
      json = rawBody ? JSON.parse(rawBody) : null
    } catch {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
    }
    if (!json || typeof json !== 'object') {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
    }

    const parsed = handbackBodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: zodErrorMessage(parsed.error) },
        { status: 400 },
      )
    }

    const auth = await authenticateConnectRequest({
      request,
      tenantId: parsed.data.tenant_id,
      rawBody,
      rateLimit: 'handoff',
    })
    if (!auth.ok) return auth.response

    const result = await setConversationHandoff({
      ctx: auth.ctx,
      conversationId,
      handoff: 'ai',
      by: parsed.data.by,
      source: 'api',
    })

    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      conversation_id: conversationId,
      handoff: result.handoff,
      changed: result.changed,
    })
  } catch (err) {
    console.error('[astra-connect v1 handback]', err)
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    return upstreamUnavailableResponse()
  }
}

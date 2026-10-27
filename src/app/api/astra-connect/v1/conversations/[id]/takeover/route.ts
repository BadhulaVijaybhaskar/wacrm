import { NextResponse } from 'next/server'
import { authenticateConnectRequest } from '@/lib/astra-connect/read-auth'
import {
  clampTakeoverReason,
  setConversationHandoff,
} from '@/lib/astra-connect/read-api'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/astra-connect/v1/conversations/:id/takeover
 * Body: { tenant_id, by?, reason? }
 * Sets handoff=human (AI replies stop). Idempotent.
 * Optional `reason` (max 500 chars) is stored on the handoff audit row.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id: conversationId } = await params
    const rawBody = await request.text()
    const body = rawBody ? JSON.parse(rawBody) : null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
    }
    const tenantId =
      typeof body.tenant_id === 'string' ? body.tenant_id.trim() : ''
    if (!tenantId) {
      return NextResponse.json(
        { error: 'tenant_id is required' },
        { status: 400 },
      )
    }

    const reason = clampTakeoverReason(
      (body as { reason?: unknown }).reason,
    )
    if (reason && typeof reason === 'object' && 'error' in reason) {
      return NextResponse.json(
        { error: 'reason must be at most 500 characters' },
        { status: 400 },
      )
    }

    const auth = await authenticateConnectRequest({
      request,
      tenantId,
      rawBody,
      rateLimit: 'handoff',
    })
    if (!auth.ok) return auth.response

    const by = typeof body.by === 'string' ? body.by : null
    const result = await setConversationHandoff({
      ctx: auth.ctx,
      conversationId,
      handoff: 'human',
      by,
      source: 'api',
      reason: typeof reason === 'string' ? reason : null,
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
    console.error('[astra-connect v1 takeover]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

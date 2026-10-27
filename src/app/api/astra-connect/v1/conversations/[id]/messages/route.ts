import { NextResponse } from 'next/server'
import { authenticateConnectRequest } from '@/lib/astra-connect/read-auth'
import {
  clampLimit,
  listConnectMessages,
} from '@/lib/astra-connect/read-api'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/astra-connect/v1/conversations/:id/messages
 *
 * Query: tenant_id (required), cursor, limit, before, after.
 * Cross-tenant conversation ids → 404.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id: conversationId } = await params
    const url = new URL(request.url)
    const tenantId = url.searchParams.get('tenant_id')?.trim() ?? ''
    if (!tenantId) {
      return NextResponse.json(
        { error: 'tenant_id is required' },
        { status: 400 },
      )
    }

    const auth = await authenticateConnectRequest({
      request,
      tenantId,
    })
    if (!auth.ok) return auth.response

    const result = await listConnectMessages({
      ctx: auth.ctx,
      conversationId,
      cursor: url.searchParams.get('cursor'),
      limit: clampLimit(url.searchParams.get('limit')),
      before: url.searchParams.get('before'),
      after: url.searchParams.get('after'),
    })

    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      messages: result.items,
      next_cursor: result.next_cursor,
    })
  } catch (err) {
    console.error('[astra-connect v1 messages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

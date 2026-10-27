import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  CONNECT_READ_NOT_MODIFIED_COST,
  consumeConnectRateLimit,
} from '@/lib/astra-connect/read-auth'
import {
  clampLimit,
  etagMatches,
  listConnectMessages,
  messageListEtag,
} from '@/lib/astra-connect/read-api'
import { rateLimitResponse } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/astra-connect/v1/conversations/:id/messages
 *
 * Query: tenant_id (required), cursor, limit, before, after.
 * `before` is the preferred older-page cursor (opaque keyset or ISO bound).
 * Cross-tenant conversation ids → 404.
 * Supports ETag / If-None-Match (304).
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
      rateLimit: 'none',
    })
    if (!auth.ok) return auth.response

    const before = url.searchParams.get('before')
    const after = url.searchParams.get('after')

    const etag = await messageListEtag({
      ctx: auth.ctx,
      conversationId,
      before,
      after,
    })
    if (etag == null) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (etagMatches(request.headers.get('if-none-match'), etag)) {
      const limit = consumeConnectRateLimit({
        tenantId: auth.ctx.tenantId,
        bucket: 'read',
        cost: CONNECT_READ_NOT_MODIFIED_COST,
      })
      if (!limit.success) return rateLimitResponse(limit)
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag },
      })
    }

    const rate = consumeConnectRateLimit({
      tenantId: auth.ctx.tenantId,
      bucket: 'read',
    })
    if (!rate.success) return rateLimitResponse(rate)

    const result = await listConnectMessages({
      ctx: auth.ctx,
      conversationId,
      cursor: url.searchParams.get('cursor'),
      limit: clampLimit(url.searchParams.get('limit')),
      before,
      after,
    })

    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if ('error' in result) {
      return NextResponse.json(
        { error: 'Invalid before cursor' },
        { status: 400 },
      )
    }

    return NextResponse.json(
      {
        messages: result.items,
        next_cursor: result.next_cursor,
      },
      {
        headers: { ETag: etag },
      },
    )
  } catch (err) {
    console.error('[astra-connect v1 messages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

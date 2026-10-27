import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  CONNECT_READ_NOT_MODIFIED_COST,
  consumeConnectRateLimit,
  isUpstreamUnavailable,
  upstreamUnavailableResponse,
} from '@/lib/astra-connect/read-auth'
import {
  etagMatches,
  listConnectMessages,
  messageListEtag,
} from '@/lib/astra-connect/read-api'
import {
  messagesQuerySchema,
  zodErrorMessage,
} from '@/lib/astra-connect/read-schemas'
import { rateLimitResponse } from '@/lib/rate-limit'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/astra-connect/v1/conversations/:id/messages
 *
 * Query: tenant_id (required), cursor, limit, before, after.
 * Auth order: zod 400 → timestamp 401 → HMAC → DB.
 * Cross-tenant / unknown conversation ids → 404.
 * Supports ETag / If-None-Match (304).
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id: conversationId } = await params
    const url = new URL(request.url)
    const parsed = messagesQuerySchema.safeParse({
      tenant_id: url.searchParams.get('tenant_id') ?? undefined,
      before: url.searchParams.get('before') ?? undefined,
      after: url.searchParams.get('after') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: zodErrorMessage(parsed.error) },
        { status: 400 },
      )
    }

    const auth = await authenticateConnectRequest({
      request,
      tenantId: parsed.data.tenant_id,
      rateLimit: 'none',
    })
    if (!auth.ok) return auth.response

    const before = parsed.data.before
    const after = parsed.data.after

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
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
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
        conversation: result.conversation,
        messages: result.items,
        next_cursor: result.next_cursor,
      },
      {
        headers: { ETag: etag },
      },
    )
  } catch (err) {
    console.error('[astra-connect v1 messages]', err)
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    return upstreamUnavailableResponse()
  }
}

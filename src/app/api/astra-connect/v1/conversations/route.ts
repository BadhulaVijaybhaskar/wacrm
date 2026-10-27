import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  CONNECT_READ_NOT_MODIFIED_COST,
  consumeConnectRateLimit,
} from '@/lib/astra-connect/read-auth'
import {
  clampLimit,
  conversationListEtag,
  etagMatches,
  listConnectConversations,
  parseHandoffFilter,
} from '@/lib/astra-connect/read-api'
import { rateLimitResponse } from '@/lib/rate-limit'

/**
 * GET /api/astra-connect/v1/conversations
 *
 * Query: tenant_id (required), employee_id, phone_number_id, handoff,
 * status, updated_since, cursor, limit (max 100).
 *
 * Auth: X-Astra-Tenant + HMAC over
 * `${ts}.${pathWithQuery}.${tenant}` (Connect console client).
 * Supports ETag / If-None-Match (304).
 */
export async function GET(request: Request) {
  try {
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

    const handoff = parseHandoffFilter(url.searchParams.get('handoff'))
    if (handoff && typeof handoff === 'object' && 'error' in handoff) {
      return NextResponse.json(
        { error: 'handoff must be ai or human' },
        { status: 400 },
      )
    }

    const filters = {
      phoneNumberId: url.searchParams.get('phone_number_id'),
      employeeId: url.searchParams.get('employee_id'),
      handoff: handoff as 'ai' | 'human' | null,
      status: url.searchParams.get('status'),
      updatedSince: url.searchParams.get('updated_since'),
    }

    const etag = await conversationListEtag({
      ctx: auth.ctx,
      ...filters,
    })
    if (etagMatches(request.headers.get('if-none-match'), etag)) {
      const limit = consumeConnectRateLimit({
        tenantId: auth.ctx.tenantId,
        bucket: 'read',
        cost: CONNECT_READ_NOT_MODIFIED_COST,
      })
      if (!limit.success) return rateLimitResponse(limit)
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
        },
      })
    }

    const limit = consumeConnectRateLimit({
      tenantId: auth.ctx.tenantId,
      bucket: 'read',
    })
    if (!limit.success) return rateLimitResponse(limit)

    const result = await listConnectConversations({
      ctx: auth.ctx,
      ...filters,
      cursor: url.searchParams.get('cursor'),
      limit: clampLimit(url.searchParams.get('limit')),
    })

    return NextResponse.json(
      {
        conversations: result.items,
        next_cursor: result.next_cursor,
      },
      {
        headers: {
          ETag: etag,
        },
      },
    )
  } catch (err) {
    console.error('[astra-connect v1 conversations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

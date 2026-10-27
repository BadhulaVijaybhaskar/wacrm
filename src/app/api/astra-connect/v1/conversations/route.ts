import { NextResponse } from 'next/server'
import {
  authenticateConnectRequest,
  CONNECT_READ_NOT_MODIFIED_COST,
  consumeConnectRateLimit,
  isUpstreamUnavailable,
  upstreamUnavailableResponse,
} from '@/lib/astra-connect/read-auth'
import {
  conversationListEtag,
  etagMatches,
  listConnectConversations,
} from '@/lib/astra-connect/read-api'
import {
  conversationsQuerySchema,
  zodErrorMessage,
} from '@/lib/astra-connect/read-schemas'
import { rateLimitResponse } from '@/lib/rate-limit'

/**
 * GET /api/astra-connect/v1/conversations
 *
 * Query: tenant_id (required), employee_id, phone_number_id, handoff,
 * status, updated_since, cursor, limit (1–100, default 50).
 *
 * Auth order: zod 400 → timestamp 401 → HMAC → DB.
 * Supports ETag / If-None-Match (304).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const parsed = conversationsQuerySchema.safeParse({
      tenant_id: url.searchParams.get('tenant_id') ?? undefined,
      employee_id: url.searchParams.get('employee_id') ?? undefined,
      phone_number_id: url.searchParams.get('phone_number_id') ?? undefined,
      handoff: url.searchParams.get('handoff') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      updated_since: url.searchParams.get('updated_since') ?? undefined,
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

    const filters = {
      phoneNumberId: parsed.data.phone_number_id,
      employeeId: parsed.data.employee_id,
      handoff: parsed.data.handoff,
      status: parsed.data.status,
      updatedSince: parsed.data.updated_since,
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

    const rate = consumeConnectRateLimit({
      tenantId: auth.ctx.tenantId,
      bucket: 'read',
    })
    if (!rate.success) return rateLimitResponse(rate)

    const result = await listConnectConversations({
      ctx: auth.ctx,
      ...filters,
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
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
    if (isUpstreamUnavailable(err)) return upstreamUnavailableResponse()
    return upstreamUnavailableResponse()
  }
}

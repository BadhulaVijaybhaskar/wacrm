import { NextResponse } from 'next/server'
import { authenticateConnectRequest } from '@/lib/astra-connect/read-auth'
import {
  clampLimit,
  listConnectConversations,
} from '@/lib/astra-connect/read-api'

/**
 * GET /api/astra-connect/v1/conversations
 *
 * Query: tenant_id (required), employee_id, phone_number_id, status,
 * updated_since, cursor, limit (max 100).
 *
 * Auth: Astra HMAC over `${timestamp}.${pathname}${search}`.
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
    })
    if (!auth.ok) return auth.response

    const result = await listConnectConversations({
      ctx: auth.ctx,
      phoneNumberId: url.searchParams.get('phone_number_id'),
      employeeId: url.searchParams.get('employee_id'),
      status: url.searchParams.get('status'),
      updatedSince: url.searchParams.get('updated_since'),
      cursor: url.searchParams.get('cursor'),
      limit: clampLimit(url.searchParams.get('limit')),
    })

    return NextResponse.json({
      conversations: result.items,
      next_cursor: result.next_cursor,
    })
  } catch (err) {
    console.error('[astra-connect v1 conversations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

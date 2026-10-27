import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { notifyConnectHandoff } from '@/lib/astra-connect'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { markCtwaConversion } from '@/lib/ads/store'

type Params = { params: Promise<{ id: string }> }

const STATUSES = new Set(['open', 'pending', 'closed'])

/**
 * PATCH /api/conversations/[id]/status  (agent+)
 *
 * Body: { status: 'open' | 'pending' | 'closed' }
 *
 * Updates the conversation status. When an agent closes the chat and
 * the Astra Connect adapter is enabled, POSTs /handoff with
 * handoff:false so the AI Employee can resume on the next inbound.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`conv-status:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { id: conversationId } = await params
    const body = await request.json().catch(() => null)
    const status = body?.status
    if (typeof status !== 'string' || !STATUSES.has(status)) {
      return NextResponse.json(
        { error: 'status must be open, pending, or closed' },
        { status: 400 }
      )
    }

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, status, astra_conversation_id, contact:contacts(phone)')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[conversations/status] lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 }
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { error: upErr } = await supabase
      .from('conversations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[conversations/status] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update status' },
        { status: 500 }
      )
    }

    if (status === 'closed') {
      void markCtwaConversion({
        db: supabaseAdmin(),
        conversationId,
      }).catch((err) =>
        console.error(
          '[ctwa] conversion mark failed:',
          err instanceof Error ? err.message : err,
        ),
      )

      const contact = conv.contact as
        | { phone?: string }
        | { phone?: string }[]
        | null
      const contactPhone = Array.isArray(contact)
        ? contact[0]?.phone
        : contact?.phone
      void notifyConnectHandoff({
        db: supabaseAdmin(),
        accountId,
        handoff: false,
        astraConversationId:
          typeof conv.astra_conversation_id === 'string'
            ? conv.astra_conversation_id
            : null,
        customerPhone: contactPhone ?? null,
        by: userId,
        reason: 'agent_closed',
      }).catch((err) =>
        console.error(
          '[astra-connect] handoff notify after close failed:',
          err instanceof Error ? err.message : err
        )
      )
    }

    return NextResponse.json({ success: true, status })
  } catch (err) {
    return toErrorResponse(err)
  }
}

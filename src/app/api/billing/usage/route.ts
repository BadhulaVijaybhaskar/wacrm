import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { billingWebhookUrl } from '@/lib/astra-billing/usage'
import { createServiceClient } from '@/lib/supabase/admin'

/**
 * GET /api/billing/usage
 *
 * Admin+ view of `astra_usage_daily` for the caller's account (last 30 UTC
 * days by default). Also reports whether BILLING_WEBHOOK_URL is configured
 * (never the URL itself).
 *
 * Reads via the service role because migration 045 locks the table behind
 * deny-all RLS (writers are service-only; this route scopes by accountId
 * after requireRole('admin')).
 */
export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const supabase = createServiceClient()
    const url = new URL(request.url)
    const daysRaw = Number(url.searchParams.get('days') ?? '30')
    const days = Number.isFinite(daysRaw)
      ? Math.min(90, Math.max(1, Math.floor(daysRaw)))
      : 30

    const since = new Date()
    since.setUTCDate(since.getUTCDate() - (days - 1))
    const sinceDay = since.toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from('astra_usage_daily')
      .select(
        'day, inbound_messages, outbound_messages, template_sends, conversations',
      )
      .eq('account_id', accountId)
      .gte('day', sinceDay)
      .order('day', { ascending: false })

    if (error) {
      console.error('[billing/usage]', error)
      return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
    }

    const rows = data ?? []
    const totals = rows.reduce(
      (acc, row) => {
        acc.inbound_messages += Number(row.inbound_messages) || 0
        acc.outbound_messages += Number(row.outbound_messages) || 0
        acc.template_sends += Number(row.template_sends) || 0
        acc.conversations += Number(row.conversations) || 0
        return acc
      },
      {
        inbound_messages: 0,
        outbound_messages: 0,
        template_sends: 0,
        conversations: 0,
      },
    )

    return NextResponse.json({
      days,
      since: sinceDay,
      billing_webhook_configured: Boolean(billingWebhookUrl()),
      totals,
      rows,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

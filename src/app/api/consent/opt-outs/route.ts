import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { applyConsentAction } from '@/lib/consent/ledger'

/**
 * GET /api/consent/opt-outs — list contacts with opted_out=true
 * POST /api/consent/opt-outs — { contact_id, action: 'opt_out' | 'opt_in' }
 *
 * Manual consent management (CHAT-11 / item 5d). STOP keywords still
 * update via the webhook; this endpoint covers agent add/remove.
 */

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, phone, email, opted_out, opted_out_at')
      .eq('account_id', accountId)
      .eq('opted_out', true)
      .order('opted_out_at', { ascending: false, nullsFirst: false })
      .limit(500)

    if (error) {
      console.error('[consent/opt-outs GET]', error)
      return NextResponse.json({ error: 'Failed to load opt-outs' }, { status: 500 })
    }

    return NextResponse.json({ contacts: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
    }
    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id.trim() : ''
    const action = body.action
    if (!contactId) {
      return NextResponse.json({ error: 'contact_id required' }, { status: 400 })
    }
    if (action !== 'opt_out' && action !== 'opt_in') {
      return NextResponse.json(
        { error: 'action must be opt_out or opt_in' },
        { status: 400 },
      )
    }

    const { data: contact, error: findErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (findErr || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const result = await applyConsentAction(supabase, {
      accountId,
      contactId,
      action,
      keyword: action === 'opt_out' ? 'MANUAL' : 'MANUAL_OPT_IN',
      source: 'manual',
    })

    return NextResponse.json({
      contact_id: contactId,
      opted_out: result.optedOut,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

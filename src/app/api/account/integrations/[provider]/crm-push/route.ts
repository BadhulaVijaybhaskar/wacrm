import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { pushContactToCrm, type CrmProvider } from '@/lib/integrations/crm/push';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const CRM: CrmProvider[] = ['hubspot', 'zoho', 'astra_crm'];

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:crmPush:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { provider: raw } = await context.params;
    if (!CRM.includes(raw as CrmProvider)) {
      return NextResponse.json({ error: 'Not a CRM provider' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    let contact = {
      phone: typeof body.phone === 'string' ? body.phone : null,
      email: typeof body.email === 'string' ? body.email : null,
      name: typeof body.name === 'string' ? body.name : null,
      company: typeof body.company === 'string' ? body.company : null,
      summary: typeof body.summary === 'string' ? body.summary : null,
    };
    let contactId =
      typeof body.contact_id === 'string' ? body.contact_id : null;

    if (contactId) {
      const { data } = await ctx.supabase
        .from('contacts')
        .select('id, phone, email, name, company')
        .eq('account_id', ctx.accountId)
        .eq('id', contactId)
        .maybeSingle();
      if (!data) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
      contact = {
        phone: data.phone,
        email: data.email,
        name: data.name,
        company: data.company,
        summary: contact.summary,
      };
      contactId = data.id;
    }

    if (!contact.phone && !contact.email) {
      return NextResponse.json(
        { error: 'phone or email required (or contact_id)' },
        { status: 400 },
      );
    }

    const result = await pushContactToCrm(ctx.supabase, {
      accountId: ctx.accountId,
      provider: raw as CrmProvider,
      contactId,
      contact,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

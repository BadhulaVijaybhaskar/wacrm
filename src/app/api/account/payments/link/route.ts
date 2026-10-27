import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  createPaymentLink,
  type PaymentProvider,
} from '@/lib/integrations/payments/links';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `agent:paymentLink:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json({ error: 'JSON required' }, { status: 400 });
    }

    const provider = body.provider;
    if (provider !== 'razorpay' && provider !== 'stripe') {
      return NextResponse.json({ error: 'provider must be razorpay|stripe' }, { status: 400 });
    }
    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : '';
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id required' }, { status: 400 });
    }
    const amountCents = Number(body.amount_cents);
    if (!Number.isFinite(amountCents) || amountCents < 1) {
      return NextResponse.json({ error: 'amount_cents required' }, { status: 400 });
    }

    const link = await createPaymentLink(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      conversationId,
      contactId:
        typeof body.contact_id === 'string' ? body.contact_id : null,
      provider: provider as PaymentProvider,
      amountCents,
      currency: typeof body.currency === 'string' ? body.currency : 'INR',
      description:
        typeof body.description === 'string' ? body.description : undefined,
    });

    return NextResponse.json({ link }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

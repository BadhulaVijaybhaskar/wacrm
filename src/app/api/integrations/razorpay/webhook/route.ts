import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { applyPaymentStatus } from '@/lib/integrations/payments/links';
import { isIntegrationsStubMode } from '@/lib/integrations/stub';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

function verifyRazorpaySignature(
  rawBody: string,
  secret: string,
  header: string | null,
): boolean {
  if (!header || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const limit = checkRateLimit(
    `rzpWebhook:${request.headers.get('x-forwarded-for') ?? 'anon'}`,
    RATE_LIMITS.webhook,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const rawBody = await request.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const entity =
    ((payload.payload as { payment_link?: { entity?: Record<string, unknown> } })
      ?.payment_link?.entity ??
      (payload.payload as { payment?: { entity?: Record<string, unknown> } })
        ?.payment?.entity ??
      {}) as Record<string, unknown>;

  const externalId = String(
    entity.id ?? payload.payment_link_id ?? payload.external_id ?? '',
  );
  if (!externalId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = supabaseAdmin();
  const { data: link } = await db
    .from('payment_links')
    .select('account_id')
    .eq('provider', 'razorpay')
    .eq('external_id', externalId)
    .maybeSingle();

  const accountId =
    (link?.account_id as string | undefined) ??
    (isIntegrationsStubMode()
      ? new URL(request.url).searchParams.get('account_id')
      : null);
  if (!accountId) {
    return NextResponse.json({ error: 'Unknown payment link' }, { status: 404 });
  }

  const { data: conn } = await db
    .from('integration_connections')
    .select('credentials_encrypted')
    .eq('account_id', accountId)
    .eq('provider', 'razorpay')
    .maybeSingle();
  const creds = decryptCredentials(conn?.credentials_encrypted as string | null);
  const sig = request.headers.get('x-razorpay-signature');
  if (!verifyRazorpaySignature(rawBody, creds.webhook_secret ?? '', sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = String(payload.event ?? '');
  const status =
    event.includes('paid') || entity.status === 'paid'
      ? 'paid'
      : event.includes('expired')
        ? 'expired'
        : event.includes('cancelled')
          ? 'cancelled'
          : 'failed';

  const result = await applyPaymentStatus(db, {
    accountId,
    provider: 'razorpay',
    externalId,
    status,
    raw: payload,
  });

  return NextResponse.json({ ok: true, ...result });
}

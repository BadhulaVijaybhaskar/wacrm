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

function verifyStripeSignature(
  rawBody: string,
  secret: string,
  header: string | null,
): boolean {
  if (!header || !secret) return false;
  // Simplified Stripe-shaped header: t=…,v1=…
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1)];
    }),
  );
  const t = parts.t;
  const v1 = parts.v1?.trim().toLowerCase();
  if (!t || !v1) return false;
  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}

export async function POST(request: Request) {
  const limit = checkRateLimit(
    `stripeWebhook:${request.headers.get('x-forwarded-for') ?? 'anon'}`,
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

  const obj = (payload.data as { object?: Record<string, unknown> } | undefined)
    ?.object;
  const externalId = String(obj?.id ?? payload.external_id ?? '');
  if (!externalId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = supabaseAdmin();
  const { data: link } = await db
    .from('payment_links')
    .select('account_id')
    .eq('provider', 'stripe')
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
    .eq('provider', 'stripe')
    .maybeSingle();
  const creds = decryptCredentials(conn?.credentials_encrypted as string | null);
  if (
    !verifyStripeSignature(
      rawBody,
      creds.webhook_secret ?? '',
      request.headers.get('stripe-signature'),
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const type = String(payload.type ?? '');
  const status =
    type.includes('paid') || obj?.status === 'paid'
      ? 'paid'
      : type.includes('expired')
        ? 'expired'
        : 'failed';

  const result = await applyPaymentStatus(db, {
    accountId,
    provider: 'stripe',
    externalId,
    status,
    raw: payload,
  });

  return NextResponse.json({ ok: true, ...result });
}

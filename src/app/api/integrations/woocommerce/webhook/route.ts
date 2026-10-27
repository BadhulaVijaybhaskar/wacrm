import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  ingestCommerceOrder,
  loadCommerceCredentials,
  mapWooTopic,
} from '@/lib/integrations/commerce/orders';
import { resolveCommerceAccountId } from '@/lib/integrations/commerce/resolve-account';
import {
  verifySharedSecret,
  verifyWooSignature,
} from '@/lib/integrations/commerce/verify';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  const limit = checkRateLimit(
    `wooWebhook:${request.headers.get('x-forwarded-for') ?? 'anon'}`,
    RATE_LIMITS.webhook,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const rawBody = await request.text();
  const topic =
    request.headers.get('x-wc-webhook-topic') ??
    request.headers.get('x-wc-webhook-event');
  const signature = request.headers.get('x-wc-webhook-signature');
  const sourceUrl = request.headers.get('x-wc-webhook-source');
  const eventType = mapWooTopic(topic);
  if (!eventType) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  let storeHost: string | null = null;
  if (sourceUrl) {
    try {
      storeHost = new URL(sourceUrl).host;
    } catch {
      storeHost = null;
    }
  }

  const db = supabaseAdmin();
  const url = new URL(request.url);
  const accountId = await resolveCommerceAccountId(db, {
    provider: 'woocommerce',
    storeHost,
    stubAccountId: url.searchParams.get('account_id'),
  });
  if (!accountId) {
    return NextResponse.json({ error: 'Unknown store' }, { status: 404 });
  }

  const creds = await loadCommerceCredentials(db, accountId, 'woocommerce');
  const secret = creds.webhook_secret ?? '';
  const headerSecret = request.headers.get('x-wc-webhook-secret');
  const okSig =
    verifyWooSignature(rawBody, secret, signature) ||
    verifySharedSecret(headerSecret, secret);
  if (!okSig) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const result = await ingestCommerceOrder(db, {
    accountId,
    provider: 'woocommerce',
    eventType,
    payload,
  });

  return NextResponse.json({ ok: true, ...result });
}

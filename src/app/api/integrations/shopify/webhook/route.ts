import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  ingestCommerceOrder,
  loadCommerceCredentials,
  mapShopifyTopic,
} from '@/lib/integrations/commerce/orders';
import { resolveCommerceAccountId } from '@/lib/integrations/commerce/resolve-account';
import { verifyShopifyHmac } from '@/lib/integrations/commerce/verify';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  const limit = checkRateLimit(
    `shopifyWebhook:${request.headers.get('x-forwarded-for') ?? 'anon'}`,
    RATE_LIMITS.webhook,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const rawBody = await request.text();
  const topic = request.headers.get('x-shopify-topic');
  const shopDomain = request.headers.get('x-shopify-shop-domain');
  const hmac = request.headers.get('x-shopify-hmac-sha256');
  const eventType = mapShopifyTopic(topic);
  if (!eventType) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = supabaseAdmin();
  const url = new URL(request.url);
  const accountId = await resolveCommerceAccountId(db, {
    provider: 'shopify',
    shopDomain,
    stubAccountId: url.searchParams.get('account_id'),
  });
  if (!accountId) {
    return NextResponse.json({ error: 'Unknown shop' }, { status: 404 });
  }

  const creds = await loadCommerceCredentials(db, accountId, 'shopify');
  const secret = creds.webhook_secret ?? '';
  if (!verifyShopifyHmac(rawBody, secret, hmac)) {
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
    provider: 'shopify',
    eventType,
    payload,
  });

  return NextResponse.json({ ok: true, ...result });
}

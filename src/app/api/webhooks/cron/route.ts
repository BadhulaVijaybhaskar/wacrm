import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { processCommerceNotifyQueue } from '@/lib/integrations/commerce/orders';
import { processWebhookRetryQueue } from '@/lib/webhooks/retry-queue';

function secretsMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Drain outbound webhook retry queue.
 * Auth: x-cron-secret === AUTOMATION_CRON_SECRET
 */
export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  if (!secretsMatch(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const webhooks = await processWebhookRetryQueue(admin, 50);
  const commerce = await processCommerceNotifyQueue(admin, 50);
  return NextResponse.json({ ok: true, webhooks, commerce });
}

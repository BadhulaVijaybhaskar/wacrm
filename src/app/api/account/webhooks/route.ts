import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { normalizeEvents } from '@/lib/webhooks/events';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  generateWebhookSecret,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      return NextResponse.json({ error: 'Failed to load webhooks' }, { status: 500 });
    }
    return NextResponse.json({
      webhooks: (data ?? []).map((r) =>
        serializeWebhookEndpoint(r as Record<string, unknown>),
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:webhookCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
    }
    const url = normalizeWebhookUrl(body.url);
    if (!url) {
      return NextResponse.json(
        { error: 'url must be a valid https:// URL' },
        { status: 400 },
      );
    }
    const events = normalizeEvents(body.events);
    if (!events) {
      return NextResponse.json(
        { error: 'events must be a non-empty array of known event names' },
        { status: 400 },
      );
    }

    const secret = generateWebhookSecret();
    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        url,
        secret: encrypt(secret),
        events,
      })
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
    }
    return NextResponse.json(
      {
        webhook: {
          ...serializeWebhookEndpoint(data as Record<string, unknown>),
          secret,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

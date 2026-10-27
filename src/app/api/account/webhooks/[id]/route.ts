import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { normalizeEvents } from '@/lib/webhooks/events';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
} from '@/lib/webhooks/endpoints';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:webhookPatch:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const patch: Record<string, unknown> = {};
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
    if (body.events !== undefined) {
      const events = normalizeEvents(body.events);
      if (!events) {
        return NextResponse.json({ error: 'Invalid events' }, { status: 400 });
      }
      patch.events = events;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No changes' }, { status: 400 });
    }
    if (patch.is_active === true) {
      patch.failure_count = 0;
    }

    const { data, error } = await ctx.supabase
      .from('webhook_endpoints')
      .update(patch)
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({
      webhook: serializeWebhookEndpoint(data as Record<string, unknown>),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:webhookDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await context.params;
    const { error, count } = await ctx.supabase
      .from('webhook_endpoints')
      .delete({ count: 'exact' })
      .eq('account_id', ctx.accountId)
      .eq('id', id);
    if (error) {
      return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
    if (!count) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

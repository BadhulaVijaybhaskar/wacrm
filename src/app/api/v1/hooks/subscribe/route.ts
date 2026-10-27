/**
 * Zapier / Make REST Hooks — subscribe
 *
 * POST { hookUrl | target_url, event | eventName }
 * Creates (or reuses) a webhook_endpoints row for the target URL.
 */

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { encrypt } from '@/lib/whatsapp/encryption';
import { isWebhookEvent, normalizeEvents } from '@/lib/webhooks/events';
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  generateWebhookSecret,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return fail('bad_request', 'JSON body required', 400);
    }

    const rawUrl = body.hookUrl ?? body.target_url ?? body.url;
    const url = normalizeWebhookUrl(rawUrl);
    if (!url) {
      return fail('bad_request', 'hookUrl must be a valid https:// URL', 400);
    }

    let events = normalizeEvents(
      body.events ??
        (typeof body.event === 'string'
          ? [body.event]
          : typeof body.eventName === 'string'
            ? [body.eventName]
            : null),
    );
    if (!events) {
      // Zapier often omits event on subscribe — default to message.received
      if (isWebhookEvent('message.received')) {
        events = ['message.received'];
      } else {
        return fail('bad_request', 'event is required', 400);
      }
    }

    // Reuse an existing endpoint for the same URL when present.
    const { data: existing } = await ctx.supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .eq('url', url)
      .maybeSingle();

    if (existing) {
      const merged = Array.from(
        new Set([
          ...((existing as { events?: string[] }).events ?? []),
          ...events,
        ]),
      );
      const { data: updated, error } = await ctx.supabase
        .from('webhook_endpoints')
        .update({ events: merged, is_active: true, failure_count: 0 })
        .eq('id', (existing as { id: string }).id)
        .select(WEBHOOK_PUBLIC_COLUMNS)
        .single();
      if (error || !updated) {
        return fail('internal', 'Failed to update subscription', 500);
      }
      return ok(serializeWebhookEndpoint(updated as Record<string, unknown>));
    }

    const secret = generateWebhookSecret();
    const { data: created, error } = await ctx.supabase
      .from('webhook_endpoints')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.createdBy,
        url,
        secret: encrypt(secret),
        events,
      })
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single();

    if (error || !created) {
      return fail('internal', 'Failed to create subscription', 500);
    }

    return ok(
      {
        ...serializeWebhookEndpoint(created as Record<string, unknown>),
        secret,
      },
      201,
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

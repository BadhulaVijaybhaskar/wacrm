/**
 * Zapier / Make REST Hooks — unsubscribe
 * DELETE or POST with { id } or { hookUrl }.
 */

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { normalizeWebhookUrl } from '@/lib/webhooks/endpoints';

async function unsubscribe(request: Request) {
  const ctx = await requireApiKey(request, 'webhooks:manage');
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const id = typeof body.id === 'string' ? body.id : null;
  const rawUrl = body.hookUrl ?? body.target_url ?? body.url;
  const url = typeof rawUrl === 'string' ? normalizeWebhookUrl(rawUrl) : null;

  if (!id && !url) {
    return fail('bad_request', 'id or hookUrl is required', 400);
  }

  let q = ctx.supabase
    .from('webhook_endpoints')
    .update({ is_active: false })
    .eq('account_id', ctx.accountId);

  if (id) q = q.eq('id', id);
  else if (url) q = q.eq('url', url);

  const { data, error } = await q.select('id');
  if (error) {
    return fail('internal', 'Failed to unsubscribe', 500);
  }

  return ok({ unsubscribed: true, matched: data?.length ?? 0 });
}

export async function POST(request: Request) {
  try {
    return await unsubscribe(request);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    return await unsubscribe(request);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

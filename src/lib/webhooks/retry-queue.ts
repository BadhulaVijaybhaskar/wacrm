/**
 * Durable retry queue for outbound webhook deliveries.
 * Cron drains pending rows with exponential backoff.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

/** Keep in sync with deliver.ts DELIVERY_TIMEOUT_MS (avoid import cycle). */
const DELIVERY_TIMEOUT_MS = 5000;

const BACKOFF_SECONDS = [30, 60, 120, 300, 600, 1800, 3600, 7200];

export function nextBackoffSeconds(attempt: number): number {
  return BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)]!;
}

export async function enqueueWebhookRetry(
  db: SupabaseClient,
  opts: {
    accountId: string;
    endpointId: string;
    event: string;
    payload: unknown;
    errorMessage?: string;
  },
): Promise<void> {
  const { error } = await db.from('webhook_delivery_queue').insert({
    account_id: opts.accountId,
    endpoint_id: opts.endpointId,
    event: opts.event,
    payload: opts.payload,
    attempt: 0,
    next_attempt_at: new Date(
      Date.now() + nextBackoffSeconds(0) * 1000,
    ).toISOString(),
    last_error: opts.errorMessage ?? null,
    status: 'pending',
  });
  if (error) {
    console.error('[webhooks] enqueue retry failed:', error.message);
  }
}

interface QueueRow {
  id: string;
  account_id: string;
  endpoint_id: string;
  event: string;
  payload: unknown;
  attempt: number;
  max_attempts: number;
}

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
  is_active: boolean;
}

/**
 * Process up to `limit` due retry rows. Safe to call from cron.
 * Never throws.
 */
export async function processWebhookRetryQueue(
  db: SupabaseClient,
  limit = 25,
): Promise<{ processed: number; delivered: number; dead: number }> {
  let processed = 0;
  let delivered = 0;
  let dead = 0;
  try {
    const { data: rows, error } = await db
      .from('webhook_delivery_queue')
      .select(
        'id, account_id, endpoint_id, event, payload, attempt, max_attempts',
      )
      .eq('status', 'pending')
      .lte('next_attempt_at', new Date().toISOString())
      .order('next_attempt_at', { ascending: true })
      .limit(limit);

    if (error || !rows?.length) {
      return { processed, delivered, dead };
    }

    for (const row of rows as QueueRow[]) {
      processed += 1;
      const { data: endpoint } = await db
        .from('webhook_endpoints')
        .select('id, url, secret, is_active')
        .eq('id', row.endpoint_id)
        .maybeSingle();

      const ep = endpoint as EndpointRow | null;
      if (!ep || !ep.is_active) {
        await db
          .from('webhook_delivery_queue')
          .update({
            status: 'dead',
            last_error: 'Endpoint missing or inactive',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        dead += 1;
        continue;
      }

      const body =
        typeof row.payload === 'string'
          ? row.payload
          : JSON.stringify(row.payload);
      const ok = await attemptDelivery(ep, row.event, body);
      if (ok) {
        await db
          .from('webhook_delivery_queue')
          .update({
            status: 'delivered',
            updated_at: new Date().toISOString(),
            last_error: null,
          })
          .eq('id', row.id);
        await db
          .from('webhook_endpoints')
          .update({
            failure_count: 0,
            last_delivery_at: new Date().toISOString(),
          })
          .eq('id', ep.id);
        delivered += 1;
        continue;
      }

      const nextAttempt = row.attempt + 1;
      if (nextAttempt >= row.max_attempts) {
        await db
          .from('webhook_delivery_queue')
          .update({
            status: 'dead',
            attempt: nextAttempt,
            last_error: 'Max attempts exhausted',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        dead += 1;
      } else {
        await db
          .from('webhook_delivery_queue')
          .update({
            attempt: nextAttempt,
            next_attempt_at: new Date(
              Date.now() + nextBackoffSeconds(nextAttempt) * 1000,
            ).toISOString(),
            last_error: 'Delivery failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
    }
  } catch (err) {
    console.error('[webhooks] process retry queue failed:', err);
  }
  return { processed, delivered, dead };
}

async function attemptDelivery(
  row: EndpointRow,
  event: string,
  payload: string,
): Promise<boolean> {
  if (!(await isDeliverableUrl(row.url))) return false;
  let secret: string;
  try {
    secret = decrypt(row.secret);
  } catch {
    return false;
  }
  const tsSeconds = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Astra-Event': event,
        'X-Astra-Webhook-Id': row.id,
        'X-Astra-Signature': buildSignatureHeader(payload, secret, tsSeconds),
      },
      body: payload,
      redirect: 'manual',
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

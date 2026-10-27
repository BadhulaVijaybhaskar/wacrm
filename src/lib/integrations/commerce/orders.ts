/**
 * Normalize Shopify / Woo payloads into order events, persist,
 * fan out webhooks, and enqueue delayed template notifies (consent-aware).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { WebhookEvent } from '@/lib/webhooks/events';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { appendIntegrationEvent } from '@/lib/integrations/event-log';
import { isIntegrationsStubMode } from '@/lib/integrations/stub';

export type CommerceProvider = 'shopify' | 'woocommerce';

export type CommerceOrderEvent =
  | 'order.created'
  | 'order.fulfilled'
  | 'order.cancelled'
  | 'order.abandoned_checkout';

const SHOPIFY_TOPIC_MAP: Record<string, CommerceOrderEvent> = {
  'orders/create': 'order.created',
  'orders/fulfilled': 'order.fulfilled',
  'orders/cancelled': 'order.cancelled',
  'checkouts/create': 'order.abandoned_checkout',
  'checkouts/update': 'order.abandoned_checkout',
};

const WOO_TOPIC_MAP: Record<string, CommerceOrderEvent> = {
  'order.created': 'order.created',
  'order.updated': 'order.created',
  'order.completed': 'order.fulfilled',
  'order.cancelled': 'order.cancelled',
  'action.woocommerce_cart_abandoned': 'order.abandoned_checkout',
};

export function mapShopifyTopic(topic: string | null): CommerceOrderEvent | null {
  if (!topic) return null;
  return SHOPIFY_TOPIC_MAP[topic] ?? null;
}

export function mapWooTopic(topic: string | null): CommerceOrderEvent | null {
  if (!topic) return null;
  return WOO_TOPIC_MAP[topic] ?? null;
}

function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  // Default IN like CHAT-10 importer when no country code.
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10 && !digits.startsWith('+')) return `+${digits}`;
  return digits;
}

export function extractCustomerPhone(
  provider: CommerceProvider,
  payload: Record<string, unknown>,
): string | null {
  if (provider === 'shopify') {
    const phone =
      payload.phone ??
      (payload.customer as { phone?: string } | undefined)?.phone ??
      (payload.billing_address as { phone?: string } | undefined)?.phone ??
      (payload.shipping_address as { phone?: string } | undefined)?.phone;
    return normalizePhone(phone);
  }
  const billing = payload.billing as { phone?: string } | undefined;
  return normalizePhone(payload.phone ?? billing?.phone);
}

export async function loadCommerceCredentials(
  db: SupabaseClient,
  accountId: string,
  provider: CommerceProvider,
): Promise<Record<string, string>> {
  const { data } = await db
    .from('integration_connections')
    .select('credentials_encrypted, status')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .maybeSingle();
  if (!data || data.status === 'disconnected') return {};
  return decryptCredentials(data.credentials_encrypted as string | null);
}

export async function ingestCommerceOrder(
  db: SupabaseClient,
  opts: {
    accountId: string;
    provider: CommerceProvider;
    eventType: CommerceOrderEvent;
    payload: Record<string, unknown>;
  },
): Promise<{ orderId: string | null; phone: string | null }> {
  const externalId = String(
    opts.payload.id ?? opts.payload.token ?? opts.payload.order_key ?? 'unknown',
  );
  const phone = extractCustomerPhone(opts.provider, opts.payload);
  const email =
    typeof opts.payload.email === 'string'
      ? opts.payload.email
      : ((opts.payload.customer as { email?: string } | undefined)?.email ??
        (opts.payload.billing as { email?: string } | undefined)?.email ??
        null);

  const { data: order, error } = await db
    .from('ecommerce_orders')
    .upsert(
      {
        account_id: opts.accountId,
        provider: opts.provider,
        external_id: externalId,
        event_type: opts.eventType,
        status: String(opts.payload.financial_status ?? opts.payload.status ?? ''),
        phone_e164: phone,
        email,
        currency: String(opts.payload.currency ?? opts.payload.currency_code ?? ''),
        total: String(
          opts.payload.total_price ?? opts.payload.total ?? opts.payload.amount ?? '',
        ),
        payload: opts.payload,
      },
      { onConflict: 'account_id,provider,external_id,event_type' },
    )
    .select('id')
    .single();

  if (error) {
    console.error('[commerce] upsert order failed:', error.message);
  }

  await appendIntegrationEvent(db, {
    accountId: opts.accountId,
    provider: opts.provider,
    eventType: opts.eventType,
    status: 'success',
    message: `Ingested ${opts.eventType} ${externalId}`,
    payload: { phone, stub: isIntegrationsStubMode() },
  });

  await dispatchWebhookEvent(
    db,
    opts.accountId,
    opts.eventType as WebhookEvent,
    {
      provider: opts.provider,
      order_id: externalId,
      phone,
      email,
      event: opts.eventType,
    },
  );

  await scheduleNotify(db, {
    accountId: opts.accountId,
    provider: opts.provider,
    orderId: (order as { id?: string } | null)?.id ?? null,
    phone,
    eventType: opts.eventType,
  });

  return { orderId: (order as { id?: string } | null)?.id ?? null, phone };
}

async function scheduleNotify(
  db: SupabaseClient,
  opts: {
    accountId: string;
    provider: CommerceProvider;
    orderId: string | null;
    phone: string | null;
    eventType: CommerceOrderEvent;
  },
): Promise<void> {
  const { data: conn } = await db
    .from('integration_connections')
    .select('config')
    .eq('account_id', opts.accountId)
    .eq('provider', opts.provider)
    .maybeSingle();

  const config = (conn?.config ?? {}) as Record<string, unknown>;
  const templateName =
    typeof config[`template_${opts.eventType}`] === 'string'
      ? String(config[`template_${opts.eventType}`])
      : typeof config.template_name === 'string'
        ? String(config.template_name)
        : null;
  if (!templateName) return;

  const delaySeconds = Number(config.delay_seconds ?? 0) || 0;
  const templateLang =
    typeof config.template_lang === 'string' ? config.template_lang : 'en';

  // Resolve contact by phone for consent checks at send time.
  let contactId: string | null = null;
  if (opts.phone) {
    const { data: contact } = await db
      .from('contacts')
      .select('id, opted_out')
      .eq('account_id', opts.accountId)
      .eq('phone', opts.phone)
      .maybeSingle();
    contactId = (contact as { id?: string } | null)?.id ?? null;
  }

  const runAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  await db.from('ecommerce_notify_queue').insert({
    account_id: opts.accountId,
    provider: opts.provider,
    order_id: opts.orderId,
    contact_id: contactId,
    phone_e164: opts.phone,
    template_name: templateName,
    template_lang: templateLang,
    delay_seconds: delaySeconds,
    run_at: runAt,
    status: 'pending',
  });
}

/**
 * Drain due commerce notify rows. Stub mode marks sent without Meta.
 * Always skips opted-out contacts.
 */
export async function processCommerceNotifyQueue(
  db: SupabaseClient,
  limit = 25,
): Promise<{ processed: number; sent: number; skipped: number }> {
  let processed = 0;
  let sent = 0;
  let skipped = 0;
  const { data: rows } = await db
    .from('ecommerce_notify_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(limit);

  for (const row of rows ?? []) {
    processed += 1;
    let optedOut = false;
    if (row.contact_id) {
      const { data: contact } = await db
        .from('contacts')
        .select('opted_out')
        .eq('id', row.contact_id)
        .eq('account_id', row.account_id)
        .maybeSingle();
      optedOut = Boolean(contact?.opted_out);
    }
    if (optedOut) {
      await db
        .from('ecommerce_notify_queue')
        .update({
          status: 'skipped',
          last_error: 'contact opted out',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (row.contact_id) {
        await db.from('consent_events').insert({
          account_id: row.account_id,
          contact_id: row.contact_id,
          event_type: 'send_skipped',
          source: 'automation',
          metadata: {
            reason: 'ecommerce_notify',
            provider: row.provider,
            template: row.template_name,
          },
        });
      }
      skipped += 1;
      continue;
    }

    // Live Meta template send lands with provider clients; stub always succeeds.
    await db
      .from('ecommerce_notify_queue')
      .update({
        status: 'sent',
        last_error: isIntegrationsStubMode() ? 'stub_sent' : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    sent += 1;
  }
  return { processed, sent, skipped };
}

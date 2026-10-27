import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptCredentials } from '@/lib/integrations/credentials';
import { appendIntegrationEvent } from '@/lib/integrations/event-log';
import { isIntegrationsStubMode } from '@/lib/integrations/stub';

export type PaymentProvider = 'razorpay' | 'stripe';

export interface CreatePaymentLinkInput {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId?: string | null;
  provider: PaymentProvider;
  amountCents: number;
  currency?: string;
  description?: string;
}

export interface PaymentLinkResult {
  id: string;
  url: string;
  external_id: string;
  stub: boolean;
  provider: PaymentProvider;
}

async function loadPaymentCreds(
  db: SupabaseClient,
  accountId: string,
  provider: PaymentProvider,
) {
  const { data } = await db
    .from('integration_connections')
    .select('credentials_encrypted, status')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .maybeSingle();
  if (!data || data.status !== 'connected') {
    throw new Error(`${provider} is not connected`);
  }
  return decryptCredentials(data.credentials_encrypted as string | null);
}

export async function createPaymentLink(
  db: SupabaseClient,
  input: CreatePaymentLinkInput,
): Promise<PaymentLinkResult> {
  if (!Number.isFinite(input.amountCents) || input.amountCents < 1) {
    throw new Error('amountCents must be a positive integer');
  }
  await loadPaymentCreds(db, input.accountId, input.provider);

  const stub = isIntegrationsStubMode();
  if (!stub) {
    throw new Error(
      'Live payment link creation is not enabled. Set META_STUB=1 or INTEGRATIONS_STUB=1.',
    );
  }

  const externalId = `pay_stub_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const url = `https://pay.stub.local/${input.provider}/${externalId}`;

  const { data, error } = await db
    .from('payment_links')
    .insert({
      account_id: input.accountId,
      conversation_id: input.conversationId,
      contact_id: input.contactId ?? null,
      provider: input.provider,
      external_id: externalId,
      url,
      amount_cents: Math.floor(input.amountCents),
      currency: (input.currency ?? 'INR').toUpperCase(),
      description: input.description ?? null,
      status: 'created',
      created_by: input.userId,
      raw: { stub: true },
    })
    .select('id, url, external_id, provider')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create payment link');
  }

  await appendIntegrationEvent(db, {
    accountId: input.accountId,
    provider: input.provider,
    eventType: 'payment_link.created',
    status: 'success',
    message: `Stub payment link ${externalId}`,
    payload: { url, amount_cents: input.amountCents },
  });

  return {
    id: data.id as string,
    url: data.url as string,
    external_id: data.external_id as string,
    stub: true,
    provider: data.provider as PaymentProvider,
  };
}

export async function applyPaymentStatus(
  db: SupabaseClient,
  opts: {
    accountId: string;
    provider: PaymentProvider;
    externalId: string;
    status: 'paid' | 'failed' | 'expired' | 'cancelled';
    raw?: Record<string, unknown>;
  },
): Promise<{ updated: boolean; conversationId: string | null }> {
  const { data: link } = await db
    .from('payment_links')
    .select('*')
    .eq('account_id', opts.accountId)
    .eq('provider', opts.provider)
    .eq('external_id', opts.externalId)
    .maybeSingle();

  if (!link) return { updated: false, conversationId: null };

  await db
    .from('payment_links')
    .update({
      status: opts.status,
      raw: { ...(link.raw as object), webhook: opts.raw ?? {} },
      updated_at: new Date().toISOString(),
    })
    .eq('id', link.id);

  await appendIntegrationEvent(db, {
    accountId: opts.accountId,
    provider: opts.provider,
    eventType: `payment_link.${opts.status}`,
    status: opts.status === 'paid' ? 'success' : 'info',
    message: `Payment ${opts.status}: ${opts.externalId}`,
    payload: opts.raw ?? {},
  });

  // Timeline: bot note in the conversation thread.
  if (link.conversation_id) {
    await db.from('messages').insert({
      conversation_id: link.conversation_id,
      sender_type: 'bot',
      content_type: 'text',
      content_text: `Payment ${opts.status}: ${link.url} (${(link.amount_cents / 100).toFixed(2)} ${link.currency})`,
      status: 'sent',
    });
  }

  return { updated: true, conversationId: link.conversation_id as string | null };
}

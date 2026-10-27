import type { SupabaseClient } from '@supabase/supabase-js';

import type { IntegrationProvider } from './catalog';

export type IntegrationEventStatus = 'info' | 'success' | 'error' | 'skipped';

export interface IntegrationEventRow {
  id: string;
  account_id: string;
  provider: string;
  event_type: string;
  status: IntegrationEventStatus;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export async function appendIntegrationEvent(
  supabase: SupabaseClient,
  opts: {
    accountId: string;
    provider: IntegrationProvider | string;
    eventType: string;
    status?: IntegrationEventStatus;
    message?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from('integration_event_log').insert({
    account_id: opts.accountId,
    provider: opts.provider,
    event_type: opts.eventType,
    status: opts.status ?? 'info',
    message: opts.message ?? null,
    payload: opts.payload ?? {},
  });
  if (error) {
    console.error('[integrations] event log insert failed:', error.message);
  }
}

export async function listIntegrationEvents(
  supabase: SupabaseClient,
  opts: {
    accountId: string;
    provider?: IntegrationProvider | string;
    limit?: number;
  },
): Promise<IntegrationEventRow[]> {
  let q = supabase
    .from('integration_event_log')
    .select('*')
    .eq('account_id', opts.accountId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.provider) {
    q = q.eq('provider', opts.provider);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as IntegrationEventRow[];
}

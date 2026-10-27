import type { SupabaseClient } from '@supabase/supabase-js';

import { isIntegrationsStubMode } from '@/lib/integrations/stub';
import type { CommerceProvider } from './orders';

/**
 * Resolve which account owns a commerce webhook.
 * Stub mode may pass ?account_id= for local fixtures.
 */
export async function resolveCommerceAccountId(
  db: SupabaseClient,
  opts: {
    provider: CommerceProvider;
    shopDomain?: string | null;
    storeHost?: string | null;
    stubAccountId?: string | null;
  },
): Promise<string | null> {
  if (isIntegrationsStubMode() && opts.stubAccountId) {
    return opts.stubAccountId;
  }

  const { data: rows } = await db
    .from('integration_connections')
    .select('account_id, config, status')
    .eq('provider', opts.provider)
    .eq('status', 'connected');

  for (const row of rows ?? []) {
    const config = (row.config ?? {}) as Record<string, unknown>;
    if (opts.provider === 'shopify') {
      const domain = String(config.shop_domain ?? '').toLowerCase();
      if (domain && opts.shopDomain && domain === opts.shopDomain.toLowerCase()) {
        return row.account_id as string;
      }
    }
    if (opts.provider === 'woocommerce') {
      const storeUrl = String(config.store_url ?? '');
      try {
        const host = new URL(storeUrl).host.toLowerCase();
        if (opts.storeHost && host === opts.storeHost.toLowerCase()) {
          return row.account_id as string;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

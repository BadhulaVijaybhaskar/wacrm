import type { SupabaseClient } from '@supabase/supabase-js';

import { isIntegrationsStubMode } from '@/lib/integrations/stub';
import type { CommerceProvider } from './orders';

const STUB_PRODUCTS = [
  {
    external_id: 'sku_demo_1',
    title: 'Demo Tee',
    sku: 'TEE-1',
    price: '799.00',
    currency: 'INR',
  },
  {
    external_id: 'sku_demo_2',
    title: 'Demo Mug',
    sku: 'MUG-1',
    price: '399.00',
    currency: 'INR',
  },
];

/** Sync product catalog — stub fixtures when INTEGRATIONS_STUB/META_STUB. */
export async function syncProductCatalog(
  db: SupabaseClient,
  opts: { accountId: string; provider: CommerceProvider },
): Promise<{ synced: number; stub: boolean }> {
  if (!isIntegrationsStubMode()) {
    // Live Graph/REST clients land later; refuse rather than call out.
    return { synced: 0, stub: false };
  }

  let synced = 0;
  for (const p of STUB_PRODUCTS) {
    const { error } = await db.from('product_catalog_items').upsert(
      {
        account_id: opts.accountId,
        provider: opts.provider,
        external_id: p.external_id,
        title: p.title,
        sku: p.sku,
        price: p.price,
        currency: p.currency,
        raw: p,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,provider,external_id' },
    );
    if (!error) synced += 1;
  }
  return { synced, stub: true };
}

/**
 * Persist CTWA attribution on contact (first-touch), conversation
 * (last-touch), and ad_attributions (report rows).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { ctwaColumns, type CtwaReferral } from './ctwa';

export async function persistCtwaAttribution(opts: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId: string;
  referral: CtwaReferral;
  /** Only write contact columns when the contact has no prior CTWA. */
  contactHasAttribution: boolean;
}): Promise<{ attributionId: string | null }> {
  const cols = ctwaColumns(opts.referral);

  const { error: convErr } = await opts.db
    .from('conversations')
    .update(cols)
    .eq('id', opts.conversationId);
  if (convErr) {
    console.error('[ctwa] conversation update failed:', convErr.message);
  }

  if (!opts.contactHasAttribution) {
    const { error: contactErr } = await opts.db
      .from('contacts')
      .update(cols)
      .eq('id', opts.contactId);
    if (contactErr) {
      console.error('[ctwa] contact update failed:', contactErr.message);
    }
  }

  const { data, error } = await opts.db
    .from('ad_attributions')
    .insert({
      account_id: opts.accountId,
      contact_id: opts.contactId,
      conversation_id: opts.conversationId,
      source_id: opts.referral.source_id,
      ctwa_clid: opts.referral.ctwa_clid,
      headline: opts.referral.headline,
      ad_id: opts.referral.ad_id,
      body: opts.referral.body,
      source_type: opts.referral.source_type,
      source_url: opts.referral.source_url,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[ctwa] attribution insert failed:', error.message);
    return { attributionId: null };
  }
  return { attributionId: data?.id ?? null };
}

/** Mark conversion when a conversation closes (or payment succeeds). */
export async function markCtwaConversion(opts: {
  db: SupabaseClient;
  conversationId: string;
}): Promise<void> {
  const at = new Date().toISOString();
  await opts.db
    .from('conversations')
    .update({ ctwa_converted_at: at })
    .eq('id', opts.conversationId)
    .is('ctwa_converted_at', null)
    .not('ctwa_source_id', 'is', null);

  await opts.db
    .from('ad_attributions')
    .update({ converted_at: at })
    .eq('conversation_id', opts.conversationId)
    .is('converted_at', null);
}

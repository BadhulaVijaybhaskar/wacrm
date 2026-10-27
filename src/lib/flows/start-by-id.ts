/**
 * Start an active flow for a contact by id (intent / manual triggers).
 * Thin wrapper around the same insert path the inbound dispatcher uses.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export async function startFlowForContact(opts: {
  db: SupabaseClient;
  accountId: string;
  flowId: string;
  contactId: string;
  conversationId: string;
}): Promise<{ started: boolean; runId?: string }> {
  const { data: flow, error } = await opts.db
    .from('flows')
    .select('*')
    .eq('id', opts.flowId)
    .eq('account_id', opts.accountId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !flow || !flow.entry_node_id) {
    if (error) console.error('[flows] startFlowForContact:', error.message);
    return { started: false };
  }

  const { data: nodes, error: nodesErr } = await opts.db
    .from('flow_nodes')
    .select('*')
    .eq('flow_id', flow.id);
  if (nodesErr) {
    console.error('[flows] startFlowForContact nodes:', nodesErr.message);
    return { started: false };
  }

  const { data: inserted, error: insErr } = await opts.db
    .from('flow_runs')
    .insert({
      flow_id: flow.id,
      account_id: flow.account_id,
      user_id: flow.user_id,
      contact_id: opts.contactId,
      conversation_id: opts.conversationId,
      status: 'active',
      current_node_key: flow.entry_node_id,
      vars: { intent_trigger: true },
    })
    .select('id')
    .maybeSingle();

  if (insErr) {
    const msg = insErr.message ?? '';
    if (msg.includes('23505') || msg.includes('duplicate key')) {
      return { started: false };
    }
    console.error('[flows] startFlowForContact insert:', insErr.message);
    return { started: false };
  }

  void nodes;
  await opts.db.rpc('increment_flow_execution_count', { p_flow_id: flow.id });
  return { started: true, runId: inserted?.id as string | undefined };
}

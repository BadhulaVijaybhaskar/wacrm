/**
 * When the Connect adapter is off, fire the intent's linked flow or
 * automation from the best local keyword match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { IntentHint } from './match';

export async function dispatchLocalIntentTriggers(opts: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
  conversationId: string;
  hints: IntentHint[];
  /** Min confidence to fire a trigger (default 0.85). */
  minConfidence?: number;
}): Promise<{ fired: string | null }> {
  const min = opts.minConfidence ?? 0.85;
  const top = opts.hints.find((h) => h.confidence >= min);
  if (!top) return { fired: null };

  if (top.trigger_automation_id) {
    const { executeAutomationById } = await import('@/lib/automations/engine');
    const ok = await executeAutomationById({
      automationId: top.trigger_automation_id,
      accountId: opts.accountId,
      contactId: opts.contactId,
      context: {
        conversation_id: opts.conversationId,
        message_text: top.matched_phrase,
        vars: {
          intent: top.name,
          intent_id: top.intent_id,
          intent_confidence: top.confidence,
        },
      },
    });
    if (ok) return { fired: `automation:${top.trigger_automation_id}` };
  }

  if (top.trigger_flow_id) {
    const { startFlowForContact } = await import('@/lib/flows/start-by-id');
    const result = await startFlowForContact({
      db: opts.db,
      accountId: opts.accountId,
      flowId: top.trigger_flow_id,
      contactId: opts.contactId,
      conversationId: opts.conversationId,
    });
    if (result.started) return { fired: `flow:${top.trigger_flow_id}` };
  }

  return { fired: null };
}

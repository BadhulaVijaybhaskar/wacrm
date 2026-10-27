import type { SupabaseClient } from '@supabase/supabase-js';

import { matchIntents, type IntentHint, type IntentPhrase } from './match';

export async function loadAccountIntentPhrases(
  db: SupabaseClient,
  accountId: string,
): Promise<IntentPhrase[]> {
  const { data: intents, error } = await db
    .from('intents')
    .select(
      'id, name, display_name, trigger_flow_id, trigger_automation_id, intent_training_phrases(phrase)',
    )
    .eq('account_id', accountId)
    .eq('enabled', true);

  if (error) {
    console.error('[intents] load failed:', error.message);
    return [];
  }

  const out: IntentPhrase[] = [];
  for (const row of intents ?? []) {
    const phrases = Array.isArray(row.intent_training_phrases)
      ? row.intent_training_phrases
      : [];
    for (const p of phrases) {
      if (typeof p.phrase !== 'string' || !p.phrase.trim()) continue;
      out.push({
        intent_id: row.id as string,
        intent_name: row.name as string,
        display_name: row.display_name as string,
        phrase: p.phrase,
        trigger_flow_id: (row.trigger_flow_id as string | null) ?? null,
        trigger_automation_id:
          (row.trigger_automation_id as string | null) ?? null,
      });
    }
  }
  return out;
}

export async function detectIntentHints(
  db: SupabaseClient,
  accountId: string,
  text: string,
): Promise<IntentHint[]> {
  const phrases = await loadAccountIntentPhrases(db, accountId);
  return matchIntents(text, phrases);
}

/**
 * Local keyword intent matching (Dialogflow-style fallback when the
 * Astra Connect adapter is off). Confidence is 1.0 for exact phrase
 * match, 0.85 for contains, 0.7 for all-tokens-present.
 */

export interface IntentPhrase {
  intent_id: string;
  intent_name: string;
  display_name: string;
  phrase: string;
  trigger_flow_id?: string | null;
  trigger_automation_id?: string | null;
}

export interface IntentHint {
  name: string;
  display_name: string;
  confidence: number;
  matched_phrase: string;
  intent_id: string;
  trigger_flow_id?: string | null;
  trigger_automation_id?: string | null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchIntents(
  text: string,
  phrases: IntentPhrase[],
  limit = 3,
): IntentHint[] {
  const hay = normalize(text);
  if (!hay || phrases.length === 0) return [];

  const scored: IntentHint[] = [];
  for (const p of phrases) {
    const needle = normalize(p.phrase);
    if (!needle) continue;
    let confidence = 0;
    if (hay === needle) confidence = 1;
    else if (hay.includes(needle)) confidence = 0.85;
    else {
      const tokens = needle.split(' ').filter(Boolean);
      if (tokens.length > 0 && tokens.every((t) => hay.includes(t))) {
        confidence = 0.7;
      }
    }
    if (confidence <= 0) continue;
    scored.push({
      name: p.intent_name,
      display_name: p.display_name,
      confidence,
      matched_phrase: p.phrase,
      intent_id: p.intent_id,
      trigger_flow_id: p.trigger_flow_id ?? null,
      trigger_automation_id: p.trigger_automation_id ?? null,
    });
  }

  // Dedupe by intent — keep highest confidence.
  const best = new Map<string, IntentHint>();
  for (const s of scored) {
    const prev = best.get(s.intent_id);
    if (!prev || s.confidence > prev.confidence) best.set(s.intent_id, s);
  }

  return [...best.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

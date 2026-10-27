/**
 * Inbound opt-out / opt-in keyword detection (CHAT-11).
 *
 * Matches whole-message keywords only (trimmed, case-insensitive) so
 * "please STOP bothering me" does not false-trigger, matching common
 * WhatsApp Business opt-out UX. Includes simple Hindi / Telugu
 * equivalents alongside the English STOP / START family.
 */

export type ConsentKeywordAction = 'opt_out' | 'opt_in';

const OPT_OUT = new Set(
  [
    'stop',
    'unsubscribe',
    'stop all',
    // Hindi (Devanagari) — common short forms
    'बंद',
    'बंद करो',
    'रुकें',
    'रुको',
    // Telugu
    'ఆపు',
    'ఆపండి',
    'నిలుపు',
  ].map((s) => s.toLowerCase()),
);

const OPT_IN = new Set(
  [
    'start',
    'subscribe',
    // Hindi
    'शुरू',
    'शुरू करें',
    // Telugu
    'ప్రారంభం',
    'సబ్స్క్రైబ్',
  ].map((s) => s.toLowerCase()),
);

/**
 * Classify a customer inbound text as opt-out / opt-in, or null when
 * it is ordinary conversation.
 */
export function detectConsentKeyword(
  text: string | null | undefined,
): { action: ConsentKeywordAction; keyword: string } | null {
  if (!text) return null;
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return null;

  if (OPT_OUT.has(normalized)) {
    return { action: 'opt_out', keyword: text.trim() };
  }
  if (OPT_IN.has(normalized)) {
    return { action: 'opt_in', keyword: text.trim() };
  }
  return null;
}

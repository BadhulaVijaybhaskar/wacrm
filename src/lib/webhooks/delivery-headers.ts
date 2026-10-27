// ============================================================
// Outbound webhook HTTP headers.
//
// Canonical names are `X-Astra-*`. For a 30-day dual-send window after
// the rename, receivers that still look for `X-Wacrm-*` keep working.
// Flip off with WEBHOOK_LEGACY_HEADERS=0 (or false/off). Default: on
// until LEGACY_HEADERS_UNTIL (inclusive UTC date).
// ============================================================

import { buildSignatureHeader } from '@/lib/webhooks/sign';

/** Last calendar day (UTC) dual-send stays on by default. */
export const LEGACY_HEADERS_UNTIL = '2026-11-26';

export function legacyWebhookHeadersEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): boolean {
  const raw = env.WEBHOOK_LEGACY_HEADERS;
  if (raw !== undefined) {
    const v = raw.trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  }
  // Default: on through LEGACY_HEADERS_UNTIL (UTC midnight next day exclusive).
  const until = Date.parse(`${LEGACY_HEADERS_UNTIL}T23:59:59.999Z`);
  return Number.isFinite(until) && now.getTime() <= until;
}

export function buildWebhookDeliveryHeaders(args: {
  event: string;
  webhookId: string;
  rawBody: string;
  secret: string;
  tsSeconds: number;
  includeLegacy?: boolean;
}): Record<string, string> {
  const signature = buildSignatureHeader(
    args.rawBody,
    args.secret,
    args.tsSeconds,
  );
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Astra-Event': args.event,
    'X-Astra-Webhook-Id': args.webhookId,
    'X-Astra-Signature': signature,
  };
  const includeLegacy = args.includeLegacy ?? legacyWebhookHeadersEnabled();
  if (includeLegacy) {
    headers['X-Wacrm-Event'] = args.event;
    headers['X-Wacrm-Webhook-Id'] = args.webhookId;
    headers['X-Wacrm-Signature'] = signature;
  }
  return headers;
}

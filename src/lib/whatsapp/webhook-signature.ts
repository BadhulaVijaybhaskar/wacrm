import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   `META_APP_SECRET` is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 *
 *   It may hold **several** secrets separated by commas (issue #500).
 *   Each Meta App signs with its own secret, so one deployment that
 *   receives webhooks from WABAs living under different Meta Apps needs
 *   to accept any of them. A request is valid when its signature
 *   matches ANY configured secret; each candidate is compared in
 *   constant time. See docs/multi-waba.md.
 */

/**
 * Split `META_APP_SECRET` into its candidate secrets: comma-separated,
 * whitespace trimmed, empties dropped. Exported for tests and for
 * anything else that wants to know how many apps are configured.
 */
export function parseAppSecrets(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function signatureMatches(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secrets = parseAppSecrets(process.env.META_APP_SECRET)
  if (secrets.length === 0) {
    console.error(
      '[webhook] META_APP_SECRET is not set — rejecting request. ' +
        'Configure the env var (Meta → App Settings → Basic → App Secret) ' +
        'to enable signature verification.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  // Deliberately no early return inside the loop's compare: every
  // candidate is checked with timingSafeEqual, and the loop cost is
  // proportional to the number of configured apps (public knowledge
  // from the operator's point of view), not to the secret contents.
  let ok = false
  for (const secret of secrets) {
    if (signatureMatches(rawBody, signatureHeader, secret)) ok = true
  }
  return ok
}

/**
 * Default Meta webhook replay window (seconds). Meta does not sign a
 * timestamp into the HMAC the way Stripe/Connect do, so we approximate
 * freshness from the newest message/status `timestamp` in the payload.
 * Entries older than this window are rejected as replayed.
 */
export const META_WEBHOOK_REPLAY_WINDOW_SECONDS = 15 * 60

/**
 * Return false when every timestamped entry in a Meta webhook body is
 * outside the replay window (or unparsable). Empty / challenge bodies
 * with no timestamps are treated as fresh so GET verification still
 * works when this helper is reused.
 */
export function isMetaWebhookPayloadFresh(
  rawBody: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  windowSeconds: number = META_WEBHOOK_REPLAY_WINDOW_SECONDS,
): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return false
  }

  const timestamps: number[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const obj = node as Record<string, unknown>
    if (typeof obj.timestamp === 'string' || typeof obj.timestamp === 'number') {
      const n = Number(obj.timestamp)
      if (Number.isFinite(n)) {
        // Meta uses unix seconds; tolerate ms.
        timestamps.push(n > 1e12 ? Math.floor(n / 1000) : n)
      }
    }
    for (const value of Object.values(obj)) walk(value)
  }
  walk(parsed)

  if (timestamps.length === 0) return true
  const newest = Math.max(...timestamps)
  return Math.abs(nowSeconds - newest) <= windowSeconds
}

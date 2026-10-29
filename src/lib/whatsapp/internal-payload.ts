/**
 * `messages.interactive_payload` doubles as storage for internal provenance
 * (e.g. `_wacrm_phone_number_id`). Keys with this prefix are never part of a
 * customer-visible payload and must not be rendered or returned by the API.
 */
const INTERNAL_KEY_PREFIX = '_wacrm_'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Removes top-level `_wacrm_*` keys; keeps everything else untouched. */
export function stripInternalPayloadKeys<T>(payload: T): T {
  if (!isPlainObject(payload)) return payload

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!key.startsWith(INTERNAL_KEY_PREFIX)) out[key] = value
  }
  return out as T
}

/**
 * Payload safe to render or serialize. A payload holding only internal keys
 * (or nothing) is treated as "no payload" so readers fall back to their
 * no-payload branch.
 */
export function publicInteractivePayload<T>(payload: T): T | null {
  if (payload == null) return null
  if (!isPlainObject(payload)) return payload

  const stripped = stripInternalPayloadKeys(payload)
  return Object.keys(stripped).length === 0 ? null : stripped
}

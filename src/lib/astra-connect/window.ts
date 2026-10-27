/**
 * WhatsApp 24-hour customer care window.
 *
 * Replies to a just-arrived inbound are always inside the window. This
 * helper exists for delayed retries / template decisions outside the
 * hot path. Free-form text outside the window must not be sent — hand
 * off to a human or send an approved template instead (contract §8).
 */

export const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * True when `lastCustomerMessageAt` is within the last 24 hours of `now`.
 * Missing/invalid timestamps are treated as closed (fail closed).
 */
export function isWithinCustomerCareWindow(
  lastCustomerMessageAt: string | Date | number | null | undefined,
  now: Date | number = Date.now()
): boolean {
  if (lastCustomerMessageAt == null) return false
  const then =
    typeof lastCustomerMessageAt === 'number'
      ? lastCustomerMessageAt
      : new Date(lastCustomerMessageAt).getTime()
  if (!Number.isFinite(then)) return false
  const nowMs = typeof now === 'number' ? now : now.getTime()
  return nowMs - then < CUSTOMER_CARE_WINDOW_MS && nowMs >= then - 60_000
}

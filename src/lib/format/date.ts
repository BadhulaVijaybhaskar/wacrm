/**
 * App-wide calendar date formatting.
 *
 * Always prefer this over bare `toLocaleDateString()` so Broadcasts,
 * Contacts, Settings, etc. render the same shape (en-US: "Oct 27, 2026").
 */

export type AppDateInput = string | number | Date

function toDate(input: AppDateInput): Date | null {
  const d = input instanceof Date ? input : new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Medium calendar date: month short + day + year.
 * Example (en-US): "Oct 27, 2026".
 */
export function formatAppDate(
  input: AppDateInput,
  locale?: string,
): string {
  const d = toDate(input)
  if (!d) return ''
  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Medium date + short time when a timestamp needs both.
 * Example (en-US): "Oct 27, 2026, 3:04 PM".
 */
export function formatAppDateTime(
  input: AppDateInput,
  locale?: string,
): string {
  const d = toDate(input)
  if (!d) return ''
  return d.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

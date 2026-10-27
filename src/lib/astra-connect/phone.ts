/**
 * Format a stored/Meta phone as E.164 with a leading `+` for Connect.
 * Connect rejects non-E.164 with 422 bad_customer_phone.
 */

import { normalizePhone } from '@/lib/whatsapp/phone-utils'

/** Digits-only or +prefixed → `+<digits>`. Empty input → empty string. */
export function toE164(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = normalizePhone(phone)
  if (!digits) return ''
  return `+${digits}`
}

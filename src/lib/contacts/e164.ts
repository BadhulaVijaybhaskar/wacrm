/**
 * E.164 phone normalization for CSV contact import (CHAT-10).
 *
 * Uses libphonenumber-js so national-format numbers can be resolved
 * against a default country (IN for this product) instead of requiring
 * a leading `+` on every row. Stored contacts and Meta sends still use
 * the digits-only / `+`-prefixed forms elsewhere in the app.
 */

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/** Product default for CSV import when the file omits a country code. */
export const DEFAULT_IMPORT_COUNTRY: CountryCode = 'IN';

/**
 * Normalize a raw phone cell to E.164 (`+` + country code + national).
 * Returns null when the value cannot be parsed as a valid number.
 *
 * - `+919876543210` → `+919876543210`
 * - `9876543210` with defaultCountry `IN` → `+919876543210`
 * - blank / garbage → null
 */
export function normalizeToE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_IMPORT_COUNTRY,
): string | null {
  if (!raw?.trim()) return null;

  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.format('E.164');
}

/** Digits-only key matching `contacts.phone_normalized` (migration 022). */
export function e164Digits(e164: string): string {
  return e164.replace(/\D/g, '');
}

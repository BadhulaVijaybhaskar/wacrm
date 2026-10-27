/**
 * Per-row CSV import validation + error CSV (CHAT-10).
 */

import type { CountryCode } from 'libphonenumber-js';
import { e164Digits, normalizeToE164 } from './e164';
import type { ParsedContactRow } from './parse-contact-csv';

export type ImportRowErrorCode =
  | 'invalid_phone'
  | 'duplicate_in_file'
  | 'duplicate_existing';

export interface ValidatedImportRow {
  /** 1-based CSV data row number (header is row 1). */
  rowNumber: number;
  raw: ParsedContactRow;
  /** E.164 when phone parsed successfully. */
  e164: string | null;
  errors: ImportRowErrorCode[];
}

export interface ValidateImportResult {
  rows: ValidatedImportRow[];
  /** Rows with a valid E.164 and no duplicate errors — ready to insert. */
  ready: Array<ParsedContactRow & { phone: string; e164: string }>;
  invalidPhone: number;
  duplicatesInFile: number;
  duplicatesExisting: number;
}

/**
 * Validate mapped rows: E.164 normalize, in-file dedupe, existing-contact
 * dedupe (by digits matching `contacts.phone_normalized`).
 */
export function validateImportRows(
  rows: ParsedContactRow[],
  options: {
    defaultCountry: CountryCode;
    /** Digits-only set from `contacts.phone_normalized`. */
    existingNormalized?: Set<string>;
  },
): ValidateImportResult {
  const existing = options.existingNormalized ?? new Set<string>();
  const seen = new Set<string>();
  const validated: ValidatedImportRow[] = [];
  const ready: Array<ParsedContactRow & { phone: string; e164: string }> = [];
  let invalidPhone = 0;
  let duplicatesInFile = 0;
  let duplicatesExisting = 0;

  rows.forEach((raw, index) => {
    const errors: ImportRowErrorCode[] = [];
    const e164 = normalizeToE164(raw.phone, options.defaultCountry);

    if (!e164) {
      errors.push('invalid_phone');
      invalidPhone++;
    } else {
      const digits = e164Digits(e164);
      if (seen.has(digits)) {
        errors.push('duplicate_in_file');
        duplicatesInFile++;
      } else {
        seen.add(digits);
        if (existing.has(digits)) {
          errors.push('duplicate_existing');
          duplicatesExisting++;
        }
      }
    }

    validated.push({
      rowNumber: index + 2, // header = 1
      raw,
      e164,
      errors,
    });

    if (e164 && errors.length === 0) {
      ready.push({
        ...raw,
        phone: e164,
        e164,
      });
    }
  });

  return {
    rows: validated,
    ready,
    invalidPhone,
    duplicatesInFile,
    duplicatesExisting,
  };
}

const ERROR_LABELS: Record<ImportRowErrorCode, string> = {
  invalid_phone: 'Invalid phone (could not normalize to E.164)',
  duplicate_in_file: 'Duplicate phone within this file',
  duplicate_existing: 'Phone already exists in contacts',
};

/** Build a downloadable error CSV for rows that failed validation/import. */
export function buildImportErrorCsv(
  rows: Array<{
    rowNumber?: number;
    phone: string;
    name?: string;
    email?: string;
    company?: string;
    errors: string[];
  }>,
): string {
  const header = 'row,phone,name,email,company,errors';
  const lines = rows.map((r) => {
    const cells = [
      r.rowNumber != null ? String(r.rowNumber) : '',
      r.phone,
      r.name ?? '',
      r.email ?? '',
      r.company ?? '',
      r.errors.join('; '),
    ];
    return cells.map(csvEscape).join(',');
  });
  return [header, ...lines].join('\n');
}

export function describeImportErrors(codes: ImportRowErrorCode[]): string[] {
  return codes.map((c) => ERROR_LABELS[c]);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

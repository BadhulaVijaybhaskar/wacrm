/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 *
 * CHAT-10 adds raw header/row extraction so the UI can offer column
 * mapping before phone/name/email/company/tags are bound.
 */

import {
  applyColumnMapping,
  autoDetectColumnMapping,
  mappingHasPhone,
} from './column-map';

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Raw CSV shape before column mapping is applied. */
export interface RawContactCsv {
  headers: string[];
  /** Data rows as cell arrays aligned to `headers`. */
  dataRows: string[][];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /**
   * True when the CSV header includes the required `phone` column.
   * `rows` is empty both when the column is missing and when the file
   * simply has no usable data rows; callers that need to tell those
   * apart (to pick the right error message) read this flag.
   */
  hasPhoneColumn: boolean;
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
}

/** Split a CSV into headers + data rows (no field binding yet). */
export function parseContactCsvRaw(text: string): RawContactCsv {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1) {
    return { headers: [], dataRows: [] };
  }

  const headers = parseCsvLine(lines[0]).map((h) =>
    h.trim().replace(/["']/g, ''),
  );
  const dataRows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    dataRows.push(parseCsvLine(line));
  }

  return { headers, dataRows };
}

/**
 * Parse with auto-detected column mapping (backward-compatible for
 * broadcasts and tests that expect exact `phone`/`name`/… headers).
 */
export function parseContactCsv(text: string): ParseContactCsvResult {
  const { headers, dataRows } = parseContactCsvRaw(text);
  if (headers.length === 0) {
    return {
      rows: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  const mapping = autoDetectColumnMapping(headers);
  const hasPhoneColumn = mappingHasPhone(mapping);
  if (!hasPhoneColumn) {
    return {
      rows: [],
      hasPhoneColumn: false,
      hasTagsColumn: false,
      hasCompanyColumn: false,
    };
  }

  // A row with no usable phone is pushed through rather than dropped
  // here — dedupeByPhone already treats an empty normalized key as
  // invalid, and counting it there means the import result can tell
  // the user "N contacts had no phone" instead of the row vanishing.
  const rows = applyColumnMapping(headers, dataRows, mapping);
  const fields = Object.values(mapping);

  return {
    rows,
    hasPhoneColumn: true,
    hasTagsColumn: fields.includes('tags'),
    hasCompanyColumn: fields.includes('company'),
  };
}

/** Simple CSV line parse (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * CSV column mapping for contact import (CHAT-10).
 *
 * Headers are rarely perfect (`Mobile`, `Phone Number`, `full_name`).
 * The importer exposes a mapping step so each CSV column can be bound
 * to phone / name / email / company / tags / ignore before validation.
 */

import { parseTagCell, type ParsedContactRow } from './parse-contact-csv';

export type ContactImportField =
  | 'phone'
  | 'name'
  | 'email'
  | 'company'
  | 'tags'
  | 'ignore';

export const CONTACT_IMPORT_FIELDS: ContactImportField[] = [
  'phone',
  'name',
  'email',
  'company',
  'tags',
  'ignore',
];

/** header index → field (one phone mapping required). */
export type ColumnMapping = Record<number, ContactImportField>;

const HEADER_ALIASES: Record<ContactImportField, string[]> = {
  phone: [
    'phone',
    'phone_number',
    'phonenumber',
    'mobile',
    'mobile_number',
    'whatsapp',
    'wa',
    'tel',
    'telephone',
    'cell',
    'cellphone',
  ],
  name: ['name', 'full_name', 'fullname', 'contact', 'contact_name', 'customer'],
  email: ['email', 'e_mail', 'email_address', 'mail'],
  company: ['company', 'organization', 'organisation', 'org', 'business'],
  tags: ['tags', 'tag', 'labels', 'label'],
  ignore: [],
};

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/[\s-]+/g, '_');
}

/** Guess a mapping from header labels; first phone-like column wins. */
export function autoDetectColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<ContactImportField>();

  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    let matched: ContactImportField = 'ignore';

    for (const field of CONTACT_IMPORT_FIELDS) {
      if (field === 'ignore') continue;
      if (used.has(field)) continue;
      if (HEADER_ALIASES[field].includes(key)) {
        matched = field;
        used.add(field);
        break;
      }
    }

    mapping[index] = matched;
  });

  return mapping;
}

export function mappingHasPhone(mapping: ColumnMapping): boolean {
  return Object.values(mapping).includes('phone');
}

/** Apply a column map to raw CSV cells → contact rows (phone still raw). */
export function applyColumnMapping(
  headers: string[],
  dataRows: string[][],
  mapping: ColumnMapping,
): ParsedContactRow[] {
  void headers;
  const phoneIdx = Object.entries(mapping).find(([, f]) => f === 'phone');
  if (!phoneIdx) return [];

  const nameIdx = Object.entries(mapping).find(([, f]) => f === 'name');
  const emailIdx = Object.entries(mapping).find(([, f]) => f === 'email');
  const companyIdx = Object.entries(mapping).find(([, f]) => f === 'company');
  const tagsIdx = Object.entries(mapping).find(([, f]) => f === 'tags');

  const phoneCol = Number(phoneIdx[0]);
  const nameCol = nameIdx ? Number(nameIdx[0]) : -1;
  const emailCol = emailIdx ? Number(emailIdx[0]) : -1;
  const companyCol = companyIdx ? Number(companyIdx[0]) : -1;
  const tagsCol = tagsIdx ? Number(tagsIdx[0]) : -1;

  const rows: ParsedContactRow[] = [];

  for (const values of dataRows) {
    if (values.every((v) => !v?.trim())) continue;

    rows.push({
      phone: values[phoneCol]?.replace(/["']/g, '').trim() ?? '',
      name:
        nameCol >= 0
          ? values[nameCol]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      email:
        emailCol >= 0
          ? values[emailCol]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      company:
        companyCol >= 0
          ? values[companyCol]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      tagNames:
        tagsCol >= 0
          ? parseTagCell(values[tagsCol]?.replace(/["']/g, ''))
          : [],
    });
  }

  return rows;
}

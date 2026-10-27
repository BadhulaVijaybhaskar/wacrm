import { afterEach, describe, expect, it } from 'vitest';

import { createSheetsClient, stubImportRows } from './client';
import {
  applyColumnMapping,
  autoDetectColumnMapping,
} from '@/lib/contacts/column-map';
import { validateImportRows } from '@/lib/contacts/validate-import';

describe('google sheets stub client', () => {
  const prev = process.env.META_STUB;
  afterEach(() => {
    if (prev === undefined) delete process.env.META_STUB;
    else process.env.META_STUB = prev;
  });

  it('imports stub rows through CHAT-10 column mapping', async () => {
    process.env.META_STUB = '1';
    const client = createSheetsClient('tok');
    const { values } = await client.getValues('sheet123', 'Sheet1!A1');
    expect(values).toEqual(stubImportRows());

    const headers = values[0]!;
    const mapping = autoDetectColumnMapping(headers);
    const mapped = applyColumnMapping(headers, values.slice(1), mapping);
    const validated = validateImportRows(mapped, {
      defaultCountry: 'IN',
      existingNormalized: new Set(),
    });
    expect(validated.ready.length).toBe(2);
    expect(validated.invalidPhone).toBe(1);
    expect(validated.ready[0]?.e164).toBe('+919876543210');
  });
});

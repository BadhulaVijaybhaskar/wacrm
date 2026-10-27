import { describe, expect, it } from 'vitest';
import {
  buildImportErrorCsv,
  describeImportErrors,
  validateImportRows,
} from './validate-import';

describe('validateImportRows', () => {
  it('normalizes IN national numbers and lists per-row errors', () => {
    const result = validateImportRows(
      [
        { phone: '9876543210', name: 'Ada', tagNames: [] },
        { phone: '9876543210', name: 'Dup', tagNames: [] },
        { phone: 'bad', name: 'Bad', tagNames: [] },
        { phone: '+14155552671', name: 'Existing', tagNames: [] },
      ],
      {
        defaultCountry: 'IN',
        existingNormalized: new Set(['14155552671']),
      },
    );

    expect(result.invalidPhone).toBe(1);
    expect(result.duplicatesInFile).toBe(1);
    expect(result.duplicatesExisting).toBe(1);
    expect(result.ready).toHaveLength(1);
    expect(result.ready[0].phone).toBe('+919876543210');
    expect(result.rows[0].e164).toBe('+919876543210');
    expect(result.rows[1].errors).toContain('duplicate_in_file');
    expect(result.rows[2].errors).toContain('invalid_phone');
    expect(result.rows[3].errors).toContain('duplicate_existing');
  });
});

describe('buildImportErrorCsv', () => {
  it('emits a downloadable CSV with escaped fields', () => {
    const csv = buildImportErrorCsv([
      {
        rowNumber: 3,
        phone: 'bad',
        name: 'Ada, "VIP"',
        errors: describeImportErrors(['invalid_phone']),
      },
    ]);
    expect(csv.split('\n')[0]).toBe('row,phone,name,email,company,errors');
    expect(csv).toContain('3,bad,"Ada, ""VIP""",,');
    expect(csv).toContain('Invalid phone');
  });
});

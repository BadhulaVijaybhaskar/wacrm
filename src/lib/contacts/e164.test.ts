import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_COUNTRY,
  e164Digits,
  normalizeToE164,
} from './e164';

describe('normalizeToE164', () => {
  it('defaults the import country to IN', () => {
    expect(DEFAULT_IMPORT_COUNTRY).toBe('IN');
  });

  it('keeps a valid international number', () => {
    expect(normalizeToE164('+919876543210')).toBe('+919876543210');
    expect(normalizeToE164('+1 (415) 555-2671')).toBe('+14155552671');
  });

  it('applies the default country to national numbers', () => {
    expect(normalizeToE164('9876543210', 'IN')).toBe('+919876543210');
    expect(normalizeToE164('09876543210', 'IN')).toBe('+919876543210');
  });

  it('returns null for blank or unparseable values', () => {
    expect(normalizeToE164('')).toBeNull();
    expect(normalizeToE164('   ')).toBeNull();
    expect(normalizeToE164('not-a-phone', 'IN')).toBeNull();
    expect(normalizeToE164('123', 'IN')).toBeNull();
  });
});

describe('e164Digits', () => {
  it('strips the leading + for phone_normalized comparison', () => {
    expect(e164Digits('+919876543210')).toBe('919876543210');
  });
});

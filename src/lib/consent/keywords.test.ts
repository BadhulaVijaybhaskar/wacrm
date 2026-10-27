import { describe, expect, it } from 'vitest';
import { detectConsentKeyword } from './keywords';

describe('detectConsentKeyword', () => {
  it('detects English opt-out whole messages', () => {
    expect(detectConsentKeyword('STOP')).toEqual({
      action: 'opt_out',
      keyword: 'STOP',
    });
    expect(detectConsentKeyword('  unsubscribe  ')).toEqual({
      action: 'opt_out',
      keyword: 'unsubscribe',
    });
    expect(detectConsentKeyword('STOP ALL')).toEqual({
      action: 'opt_out',
      keyword: 'STOP ALL',
    });
  });

  it('detects English opt-in whole messages', () => {
    expect(detectConsentKeyword('START')?.action).toBe('opt_in');
    expect(detectConsentKeyword('subscribe')?.action).toBe('opt_in');
  });

  it('detects simple Hindi and Telugu equivalents', () => {
    expect(detectConsentKeyword('बंद')?.action).toBe('opt_out');
    expect(detectConsentKeyword('ఆపు')?.action).toBe('opt_out');
    expect(detectConsentKeyword('शुरू')?.action).toBe('opt_in');
  });

  it('ignores keywords embedded in longer sentences', () => {
    expect(detectConsentKeyword('please STOP messaging me')).toBeNull();
    expect(detectConsentKeyword('I want to START over')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(detectConsentKeyword('')).toBeNull();
    expect(detectConsentKeyword(null)).toBeNull();
  });
});

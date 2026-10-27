import { describe, expect, it } from 'vitest';

import {
  buildPasswordResetRedirectTo,
  PASSWORD_RESET_NEXT_PATH,
  sanitizeAuthCallbackNext,
  validateNewPassword,
} from './password-reset';

describe('buildPasswordResetRedirectTo', () => {
  it('points at /auth/callback with next=/reset-password', () => {
    expect(buildPasswordResetRedirectTo('https://chat.example.com')).toBe(
      `https://chat.example.com/auth/callback?next=${encodeURIComponent(PASSWORD_RESET_NEXT_PATH)}`,
    );
  });

  it('strips a trailing slash on the origin', () => {
    expect(buildPasswordResetRedirectTo('http://127.0.0.1:3000/')).toContain(
      'http://127.0.0.1:3000/auth/callback?',
    );
  });
});

describe('sanitizeAuthCallbackNext', () => {
  it('allows relative app paths', () => {
    expect(sanitizeAuthCallbackNext('/reset-password')).toBe('/reset-password');
    expect(sanitizeAuthCallbackNext('/settings?tab=profile')).toBe(
      '/settings?tab=profile',
    );
  });

  it('rejects open redirects', () => {
    expect(sanitizeAuthCallbackNext('https://evil.test/phish')).toBe(
      '/dashboard',
    );
    expect(sanitizeAuthCallbackNext('//evil.test')).toBe('/dashboard');
    expect(sanitizeAuthCallbackNext('dashboard')).toBe('/dashboard');
    expect(sanitizeAuthCallbackNext('')).toBe('/dashboard');
    expect(sanitizeAuthCallbackNext(null)).toBe('/dashboard');
  });
});

describe('validateNewPassword', () => {
  it('accepts a matching password of sufficient length', () => {
    expect(validateNewPassword('longenough', 'longenough')).toEqual({
      ok: true,
    });
  });

  it('rejects short or mismatched passwords', () => {
    expect(validateNewPassword('short', 'short')).toEqual({
      ok: false,
      reason: 'too_short',
    });
    expect(validateNewPassword('longenough', 'different1')).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });
});

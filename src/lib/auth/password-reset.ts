/**
 * Helpers for the forgot-password → email link → reset-password flow.
 * Kept pure so unit tests can cover the golden-rule E2E path without
 * spinning up Supabase.
 */

export const PASSWORD_RESET_NEXT_PATH = '/reset-password';

export const MIN_RESET_PASSWORD_LENGTH = 8;

/** Build the Supabase `redirectTo` used by the forgot-password form. */
export function buildPasswordResetRedirectTo(origin: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/auth/callback?next=${encodeURIComponent(PASSWORD_RESET_NEXT_PATH)}`;
}

/**
 * Only allow same-origin relative paths. Rejects protocol-relative URLs
 * (`//evil`), absolute URLs, and empty values.
 */
export function sanitizeAuthCallbackNext(
  raw: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!raw || typeof raw !== 'string') return fallback;
  const next = raw.trim();
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//')) return fallback;
  if (next.includes('://')) return fallback;
  return next;
}

export function validateNewPassword(
  password: string,
  confirm: string,
  minLength = MIN_RESET_PASSWORD_LENGTH,
): { ok: true } | { ok: false; reason: 'too_short' | 'mismatch' } {
  if (password.length < minLength) return { ok: false, reason: 'too_short' };
  if (password !== confirm) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

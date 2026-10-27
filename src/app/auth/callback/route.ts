import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { sanitizeAuthCallbackNext } from '@/lib/auth/password-reset';
import { createClient } from '@/lib/supabase/server';

/**
 * Supabase auth email links land here (password recovery, confirm signup).
 * Exchanges the `code` (PKCE) or `token_hash`+`type` (OTP) for a session,
 * then redirects to a sanitized same-origin `next` path.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = sanitizeAuthCallbackNext(url.searchParams.get('next'));
  const origin = url.origin;

  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  const fail = new URL('/login', origin);
  fail.searchParams.set('error', 'auth_callback');
  return NextResponse.redirect(fail);
}

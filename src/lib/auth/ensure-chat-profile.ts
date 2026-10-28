import type { SupabaseClient } from '@supabase/supabase-js';

import { hashInviteToken } from '@/lib/auth/invitations';

/**
 * App-side bootstrap for a Chat profile + personal account.
 *
 * Shared-project installs must NOT put triggers on `auth.users` (Voice
 * signups must never create Chat rows). Call this on first Chat login
 * when `profiles` has no row for the signed-in user.
 *
 * Calls the SECURITY DEFINER RPC `ensure_chat_profile` (wacrm schema
 * pack / invite-gate SQL). Direct INSERT into profiles is blocked by
 * RLS on shared installs — there is no fallback path.
 *
 * When signup is invite-only (DB `app_runtime_config.signup_mode`), pass
 * `inviteToken` from `/join/<token>` or `?invite=` so the RPC can allow
 * bootstrap before `redeem_invitation`.
 */
export async function ensureChatProfile(
  db: SupabaseClient,
  user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  },
  opts?: { inviteToken?: string | null },
): Promise<{ created: boolean; error?: string }> {
  const fullName =
    (typeof user.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : '') || '';

  const token = opts?.inviteToken?.trim() || '';
  const args: { p_full_name: string; p_invite_token_hash?: string } = {
    p_full_name: fullName,
  };
  if (token) {
    args.p_invite_token_hash = hashInviteToken(token);
  }

  const rpc = await db.rpc('ensure_chat_profile', args);

  if (!rpc.error) {
    return { created: true };
  }

  return {
    created: false,
    error: rpc.error.message,
  };
}

/** Read invite token from the browser location (join path or ?invite=). */
export function readInviteTokenFromLocation(
  loc: { pathname: string; search: string } | null | undefined =
    typeof window !== 'undefined' ? window.location : null,
): string | null {
  if (!loc) return null;
  const join = loc.pathname.match(/^\/join\/([^/]+)\/?$/);
  if (join?.[1]) {
    try {
      return decodeURIComponent(join[1]);
    } catch {
      return join[1];
    }
  }
  const q = new URLSearchParams(loc.search).get('invite');
  const trimmed = q?.trim();
  return trimmed ? trimmed : null;
}

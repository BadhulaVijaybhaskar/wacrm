import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * App-side bootstrap for a Chat profile + personal account.
 *
 * Shared-project installs must NOT put triggers on `auth.users` (Voice
 * signups must never create Chat rows). Call this on first Chat login
 * when `profiles` has no row for the signed-in user.
 *
 * Calls the SECURITY DEFINER RPC `ensure_chat_profile` (wacrm schema
 * pack / migration 059). Direct INSERT into profiles is blocked by RLS
 * on shared installs — there is no fallback path.
 */
export async function ensureChatProfile(
  db: SupabaseClient,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
): Promise<{ created: boolean; error?: string }> {
  const fullName =
    (typeof user.user_metadata?.full_name === 'string'
      ? user.user_metadata.full_name
      : '') || '';

  const rpc = await db.rpc('ensure_chat_profile', {
    p_full_name: fullName,
  });

  if (!rpc.error) {
    return { created: true };
  }

  return {
    created: false,
    error: rpc.error.message,
  };
}

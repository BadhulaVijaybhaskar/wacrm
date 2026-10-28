import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * App-side bootstrap for a Chat profile + personal account.
 *
 * Shared-project installs must NOT put triggers on `auth.users` (Voice
 * signups must never create Chat rows). Call this on first Chat login
 * when `profiles` has no row for the signed-in user.
 *
 * Prefers the SECURITY DEFINER RPC `ensure_chat_profile` (defined in
 * the wacrm schema pack / migration 059). Falls back to a best-effort
 * direct insert path for older DBs that still have the signup trigger
 * but somehow missed a row.
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

  // RPC missing (legacy public DB that still uses the auth trigger) —
  // try a direct accounts + profiles insert. RLS may block accounts
  // insert; treat that as non-fatal so the caller can surface status.
  const accountName = fullName || user.email || 'My account';
  const { data: account, error: accountErr } = await db
    .from('accounts')
    .insert({ name: accountName, owner_user_id: user.id })
    .select('id')
    .maybeSingle();

  if (accountErr || !account?.id) {
    return {
      created: false,
      error: accountErr?.message ?? rpc.error.message,
    };
  }

  const { error: profileErr } = await db.from('profiles').insert({
    user_id: user.id,
    full_name: fullName,
    email: user.email ?? null,
    account_id: account.id,
    account_role: 'owner',
  });

  if (profileErr) {
    return { created: false, error: profileErr.message };
  }
  return { created: true };
}

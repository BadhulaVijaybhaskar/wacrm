import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Delete an auth user safely on a shared Supabase project.
 *
 * `accounts.owner_user_id` is ON DELETE CASCADE in the shared-sql-v2
 * pack: removing an owner auth user deletes the whole Chat tenant
 * (including teammates). Transfer ownership first when the target
 * still owns an account.
 *
 * `db` must be a service-role client (schema-aware). `deleteAuthUser`
 * is injected so callers (admin API, smoke scripts) control the Auth
 * Admin delete without baking in supabase-js auth.admin here.
 */
export async function transferOwnershipThenDeleteAuthUser(
  db: SupabaseClient,
  userId: string,
  deleteAuthUser: (userId: string) => Promise<void>,
  options?: {
    /** When set, transfer to this member before deleting. Required if the
     * target still owns an account that has other members. */
    newOwnerUserId?: string;
  },
): Promise<{ transferred: boolean }> {
  const { data: owned, error: ownedErr } = await db
    .from('accounts')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (ownedErr) {
    throw new Error(ownedErr.message);
  }

  let transferred = false;
  if (owned?.id) {
    if (!options?.newOwnerUserId) {
      throw new Error(
        'Cannot delete account owner without transferring ownership first (transfer_account_ownership).',
      );
    }
    // Call as the current owner: set auth context via RPC expects
    // auth.uid(). Service-role paths that delete users after a Voice
    // admin action should promote a teammate first through the
    // transfer_ownership HTTP route (user-scoped), or call the RPC
    // with a session that is the owner. Here we invoke the RPC with
    // the service client only when the caller already arranged a
    // direct SQL transfer; prefer the HTTP route in product code.
    const { error } = await db.rpc('transfer_account_ownership', {
      p_new_owner_user_id: options.newOwnerUserId,
    });
    if (error) {
      throw new Error(error.message);
    }
    transferred = true;
  }

  await deleteAuthUser(userId);
  return { transferred };
}

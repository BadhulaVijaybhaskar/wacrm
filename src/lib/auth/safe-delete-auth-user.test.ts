import { describe, expect, it, vi } from 'vitest';

import { transferOwnershipThenDeleteAuthUser } from './safe-delete-auth-user';

describe('transferOwnershipThenDeleteAuthUser', () => {
  it('transfers ownership then deletes when the user owns an account', async () => {
    const deleteAuthUser = vi.fn(async () => undefined);
    const db = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'acct-1' }, error: null }),
          }),
        }),
      })),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };

    const result = await transferOwnershipThenDeleteAuthUser(
      db as never,
      'owner-1',
      deleteAuthUser,
      { newOwnerUserId: 'member-2' },
    );

    expect(result).toEqual({ transferred: true });
    expect(db.rpc).toHaveBeenCalledWith('transfer_account_ownership', {
      p_new_owner_user_id: 'member-2',
    });
    expect(deleteAuthUser).toHaveBeenCalledWith('owner-1');
  });

  it('refuses to delete an owner without a transfer target', async () => {
    const deleteAuthUser = vi.fn(async () => undefined);
    const db = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'acct-1' }, error: null }),
          }),
        }),
      })),
      rpc: vi.fn(),
    };

    await expect(
      transferOwnershipThenDeleteAuthUser(db as never, 'owner-1', deleteAuthUser),
    ).rejects.toThrow(/transferring ownership/i);
    expect(deleteAuthUser).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('deletes non-owners without transferring', async () => {
    const deleteAuthUser = vi.fn(async () => undefined);
    const db = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      })),
      rpc: vi.fn(),
    };

    const result = await transferOwnershipThenDeleteAuthUser(
      db as never,
      'agent-1',
      deleteAuthUser,
    );
    expect(result).toEqual({ transferred: false });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(deleteAuthUser).toHaveBeenCalledWith('agent-1');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { ensureChatProfile } from './ensure-chat-profile';

describe('ensureChatProfile', () => {
  it('returns created when ensure_chat_profile RPC succeeds', async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(),
    };
    const result = await ensureChatProfile(db as never, {
      id: 'u1',
      email: 'a@b.co',
      user_metadata: { full_name: 'Ada' },
    });
    expect(result).toEqual({ created: true });
    expect(db.rpc).toHaveBeenCalledWith('ensure_chat_profile', {
      p_full_name: 'Ada',
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('falls back to direct inserts when RPC is missing', async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'function ensure_chat_profile does not exist' },
      })),
      from: vi.fn((table: string) => {
        if (table === 'accounts') {
          return {
            insert: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: { id: 'acct-1' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          insert: async () => ({ error: null }),
        };
      }),
    };
    const result = await ensureChatProfile(db as never, {
      id: 'u1',
      email: 'a@b.co',
    });
    expect(result).toEqual({ created: true });
    expect(db.from).toHaveBeenCalledWith('accounts');
    expect(db.from).toHaveBeenCalledWith('profiles');
  });
});

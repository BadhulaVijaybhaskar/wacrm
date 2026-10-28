import { describe, expect, it, vi } from 'vitest';

import {
  ensureChatProfile,
  readInviteTokenFromLocation,
} from './ensure-chat-profile';
import { hashInviteToken } from './invitations';

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

  it('passes hashed invite token for /join bootstrap', async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(),
    };
    const token = 'join-token-abc';
    await ensureChatProfile(
      db as never,
      { id: 'u1', email: 'a@b.co' },
      { inviteToken: token },
    );
    expect(db.rpc).toHaveBeenCalledWith('ensure_chat_profile', {
      p_full_name: '',
      p_invite_token_hash: hashInviteToken(token),
    });
  });

  it('does not fall back to direct profile inserts when RPC fails', async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'function ensure_chat_profile does not exist' },
      })),
      from: vi.fn(),
    };
    const result = await ensureChatProfile(db as never, {
      id: 'u1',
      email: 'a@b.co',
    });
    expect(result).toEqual({
      created: false,
      error: 'function ensure_chat_profile does not exist',
    });
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('readInviteTokenFromLocation', () => {
  it('reads /join/<token>', () => {
    expect(
      readInviteTokenFromLocation({
        pathname: '/join/abc%2Fdef',
        search: '',
      }),
    ).toBe('abc/def');
  });

  it('reads ?invite=', () => {
    expect(
      readInviteTokenFromLocation({
        pathname: '/signup',
        search: '?invite=tok_1',
      }),
    ).toBe('tok_1');
  });

  it('returns null when absent', () => {
    expect(
      readInviteTokenFromLocation({ pathname: '/inbox', search: '' }),
    ).toBeNull();
  });
});

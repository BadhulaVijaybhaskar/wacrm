import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn(async () => ({
  data: { ok: true, account_name: 'Acme', role: 'agent' },
  error: null,
}));
const createServiceClient = vi.fn(() => ({ rpc }));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: () => createServiceClient(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response('limited', { status: 429 }),
  RATE_LIMITS: { invitationPeek: { limit: 10, windowMs: 60_000 } },
}));

vi.mock('@/lib/auth/invitations', () => ({
  hashInviteToken: (token: string) => `hash:${token}`,
}));

describe('GET /api/invitations/[token]/peek', () => {
  beforeEach(() => {
    rpc.mockClear();
    createServiceClient.mockClear();
  });

  it('calls peek_invitation via the service-role client', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/invitations/tok/peek'), {
      params: Promise.resolve({ token: 'tok' }),
    });
    expect(res.status).toBe(200);
    expect(createServiceClient).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('peek_invitation', {
      p_token_hash: 'hash:tok',
    });
    await expect(res.json()).resolves.toEqual({
      ok: true,
      account_name: 'Acme',
      role: 'agent',
    });
  });
});

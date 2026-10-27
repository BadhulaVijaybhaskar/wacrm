import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession,
      verifyOtp,
    },
  })),
}));

import { GET } from './route';

function req(path: string) {
  return new Request(`http://127.0.0.1:3000${path}`) as unknown as import('next/server').NextRequest;
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    verifyOtp.mockReset();
  });

  it('exchanges a PKCE code and redirects to sanitized next', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(
      req('/auth/callback?code=abc&next=%2Freset-password'),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://127.0.0.1:3000/reset-password',
    );
  });

  it('rejects open-redirect next values', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const res = await GET(
      req('/auth/callback?code=abc&next=https%3A%2F%2Fevil.test'),
    );
    expect(res.headers.get('location')).toBe(
      'http://127.0.0.1:3000/dashboard',
    );
  });

  it('falls back to verifyOtp when token_hash+type are present', async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(
      req('/auth/callback?token_hash=tok&type=recovery&next=/reset-password'),
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      token_hash: 'tok',
    });
    expect(res.headers.get('location')).toBe(
      'http://127.0.0.1:3000/reset-password',
    );
  });

  it('redirects to login when exchange fails', async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { message: 'bad code' },
    });
    const res = await GET(req('/auth/callback?code=bad'));
    expect(res.headers.get('location')).toBe(
      'http://127.0.0.1:3000/login?error=auth_callback',
    );
  });
});

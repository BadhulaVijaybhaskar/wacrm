import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrl = vi.fn(async () => ({
  data: { signedUrl: 'https://signed.example/meta?token=1' },
  error: null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: () => ({
    storage: {
      from: vi.fn(() => ({ createSignedUrl })),
    },
  }),
}));

vi.mock('@/lib/supabase/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/config')>();
  return {
    ...actual,
    storageBucket: (name: string) => `wacrm-${name}`,
  };
});

describe('resolveMetaMediaLink', () => {
  beforeEach(() => {
    createSignedUrl.mockClear();
  });

  it('passes through external absolute URLs without signing', async () => {
    const { resolveMetaMediaLink } = await import('./resolve-meta-media');
    await expect(
      resolveMetaMediaLink('https://cdn.example/img.jpg'),
    ).resolves.toBe('https://cdn.example/img.jpg');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('signs storage object paths with the Meta TTL', async () => {
    const { resolveMetaMediaLink } = await import('./resolve-meta-media');
    await expect(
      resolveMetaMediaLink('account-1/photo.png', 'chat-media'),
    ).resolves.toBe('https://signed.example/meta?token=1');
    expect(createSignedUrl).toHaveBeenCalledWith('account-1/photo.png', 3600);
  });
});

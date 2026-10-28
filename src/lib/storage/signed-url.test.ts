import { describe, expect, it, vi } from 'vitest';
import {
  isHttpUrl,
  isStorageObjectPath,
  parseStoredMediaRef,
  resolveSignedMediaUrl,
} from './signed-url';

describe('signed-url helpers', () => {
  it('detects http URLs vs storage paths', () => {
    expect(isHttpUrl('https://x/y')).toBe(true);
    expect(isStorageObjectPath('account-abc/file.png')).toBe(true);
    expect(isStorageObjectPath('https://x/y')).toBe(false);
    expect(isStorageObjectPath('/api/whatsapp/media/1')).toBe(false);
    expect(isStorageObjectPath('not a url')).toBe(false);
    expect(isStorageObjectPath('filename-only.png')).toBe(false);
  });

  it('parses legacy public storage URLs into bucket+path', () => {
    const ref = parseStoredMediaRef(
      'https://xyz.supabase.co/storage/v1/object/public/wacrm-chat-media/account-1/a.png',
      'fallback',
    );
    expect(ref).toEqual({
      kind: 'path',
      bucket: 'wacrm-chat-media',
      path: 'account-1/a.png',
    });
  });

  it('passes through external absolute URLs', () => {
    expect(
      parseStoredMediaRef('https://cdn.example/img.jpg', 'chat-media'),
    ).toEqual({ kind: 'absolute', url: 'https://cdn.example/img.jpg' });
  });

  it('treats bare paths as belonging to the default bucket', () => {
    expect(parseStoredMediaRef('account-1/x.png', 'wacrm-avatars')).toEqual({
      kind: 'path',
      bucket: 'wacrm-avatars',
      path: 'account-1/x.png',
    });
  });

  it('resolveSignedMediaUrl signs paths and returns absolute URLs unchanged', async () => {
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: 'https://signed.example/x?token=1' },
      error: null,
    }));
    const storage = { from: vi.fn(() => ({ createSignedUrl })) };

    await expect(
      resolveSignedMediaUrl(
        storage,
        'wacrm-chat-media',
        'https://cdn.example/keep.jpg',
        60,
      ),
    ).resolves.toBe('https://cdn.example/keep.jpg');
    expect(createSignedUrl).not.toHaveBeenCalled();

    await expect(
      resolveSignedMediaUrl(
        storage,
        'wacrm-chat-media',
        'account-1/photo.png',
        3600,
      ),
    ).resolves.toBe('https://signed.example/x?token=1');
    expect(storage.from).toHaveBeenCalledWith('wacrm-chat-media');
    expect(createSignedUrl).toHaveBeenCalledWith('account-1/photo.png', 3600);
  });
});

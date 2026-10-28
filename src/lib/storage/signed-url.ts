/**
 * Private-bucket media refs (shared-sql-v2).
 *
 * New writes store a Storage **object path** (e.g. `account-<uuid>/…`)
 * rather than a public URL. Display and Meta-send mint short-lived
 * signed URLs. Existing rows that still hold full `https://…` URLs
 * keep working: absolute URLs pass through; Supabase public/sign URLs
 * are parsed back to bucket+path when possible.
 */

export const DISPLAY_SIGNED_URL_TTL_SEC = 15 * 60;
/** Long enough for Meta to fetch outbound media / template samples. */
export const META_SIGNED_URL_TTL_SEC = 60 * 60;

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** True when `value` looks like a Storage object path (not a URL). */
export function isStorageObjectPath(value: string): boolean {
  const v = value.trim();
  if (!v || isHttpUrl(v) || v.startsWith('/') || v.startsWith('blob:')) {
    return false;
  }
  // Proxy routes stay absolute-ish paths under /api/…
  if (v.startsWith('api/')) return false;
  // Require a folder/object separator and no whitespace so free-text
  // like "not a url" is not mistaken for a Storage key.
  if (/\s/.test(v) || !v.includes('/')) return false;
  return true;
}

export type ParsedMediaRef =
  | { kind: 'path'; bucket: string; path: string }
  | { kind: 'absolute'; url: string };

/**
 * Interpret a stored media/avatar ref.
 * - http(s) Supabase storage URLs → bucket + path
 * - other http(s) → absolute (external CDN / legacy)
 * - bare path → defaultBucket + path
 */
export function parseStoredMediaRef(
  value: string,
  defaultBucket: string,
): ParsedMediaRef {
  const v = value.trim();
  if (!v) {
    return { kind: 'path', bucket: defaultBucket, path: '' };
  }
  if (!isHttpUrl(v)) {
    return { kind: 'path', bucket: defaultBucket, path: v.replace(/^\//, '') };
  }

  try {
    const u = new URL(v);
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
    );
    if (m) {
      return {
        kind: 'path',
        bucket: decodeURIComponent(m[1]),
        path: decodeURIComponent(m[2]),
      };
    }
  } catch {
    // fall through
  }
  return { kind: 'absolute', url: v };
}

type StorageLike = {
  from: (bucket: string) => {
    createSignedUrl: (
      path: string,
      expiresIn: number,
    ) => Promise<{
      data: { signedUrl: string } | null;
      error: { message?: string } | null;
    }>;
  };
};

/**
 * Resolve a stored path/URL to something fetchable.
 * Absolute URLs return as-is; paths get a signed URL.
 */
export async function resolveSignedMediaUrl(
  storage: StorageLike,
  defaultBucket: string,
  pathOrUrl: string,
  expiresIn: number,
): Promise<string> {
  const parsed = parseStoredMediaRef(pathOrUrl, defaultBucket);
  if (parsed.kind === 'absolute') return parsed.url;
  if (!parsed.path) {
    throw new Error('Empty storage path');
  }
  const { data, error } = await storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Failed to create signed URL');
  }
  return data.signedUrl;
}

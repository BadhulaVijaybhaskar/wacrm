import { createServiceClient } from '@/lib/supabase/admin';
import { storageBucket } from '@/lib/supabase/config';
import {
  META_SIGNED_URL_TTL_SEC,
  isHttpUrl,
  isStorageObjectPath,
  resolveSignedMediaUrl,
} from '@/lib/storage/signed-url';

/**
 * Mint a Meta-fetchable URL for a stored media ref.
 *
 * Persisted values are Storage object paths (private buckets) or legacy
 * absolute URLs. Meta always needs an http(s) link, so paths (and
 * former public Supabase object URLs) get a service-role signed URL
 * with {@link META_SIGNED_URL_TTL_SEC}.
 */
export async function resolveMetaMediaLink(
  pathOrUrl: string,
  logicalBucket: 'chat-media' | 'flow-media' | 'avatars' = 'chat-media',
): Promise<string> {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) {
    throw new Error('Empty media ref');
  }
  // Fast path: already a non-Supabase absolute URL (external CDN).
  // Still run through resolveSignedMediaUrl so legacy public bucket
  // URLs are re-signed after the shared-project private-bucket flip.
  if (
    isHttpUrl(trimmed) &&
    !trimmed.includes('/storage/v1/object/')
  ) {
    return trimmed;
  }
  if (
    !isHttpUrl(trimmed) &&
    !isStorageObjectPath(trimmed)
  ) {
    // Relative proxy paths (/api/whatsapp/media/…) are not Meta-sendable.
    throw new Error('Media ref is not a Storage path or http(s) URL');
  }
  const storage = createServiceClient().storage;
  return resolveSignedMediaUrl(
    storage,
    storageBucket(logicalBucket),
    trimmed,
    META_SIGNED_URL_TTL_SEC,
  );
}

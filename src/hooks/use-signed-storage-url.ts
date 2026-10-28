'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  DISPLAY_SIGNED_URL_TTL_SEC,
  isHttpUrl,
  isStorageObjectPath,
  parseStoredMediaRef,
  resolveSignedMediaUrl,
} from '@/lib/storage/signed-url';

/**
 * Resolve a stored media/avatar ref to a browser-fetchable URL.
 *
 * - Absolute non-storage URLs → returned as-is.
 * - Storage object paths (and legacy public/sign Supabase URLs) →
 *   short-lived signed URL via the browser Supabase client.
 * - Empty / undefined → null.
 */
export function useSignedStorageUrl(
  pathOrUrl: string | null | undefined,
  defaultBucket: string,
  expiresIn: number = DISPLAY_SIGNED_URL_TTL_SEC,
): string | null {
  const [signed, setSigned] = useState<string | null>(() => {
    if (!pathOrUrl?.trim()) return null;
    const v = pathOrUrl.trim();
    // Immediate paint for plain absolute URLs that are not Supabase
    // storage objects (external CDNs). Storage URLs need a sign round-trip.
    if (isHttpUrl(v) && !v.includes('/storage/v1/object/')) return v;
    if (v.startsWith('blob:') || v.startsWith('data:')) return v;
    return null;
  });

  useEffect(() => {
    if (!pathOrUrl?.trim()) {
      setSigned(null);
      return;
    }
    const v = pathOrUrl.trim();
    if (isHttpUrl(v) && !v.includes('/storage/v1/object/')) {
      setSigned(v);
      return;
    }
    if (v.startsWith('blob:') || v.startsWith('data:')) {
      setSigned(v);
      return;
    }
    // Proxy routes are already app-auth'd — leave unchanged.
    if (v.startsWith('/api/')) {
      setSigned(v);
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    const parsed = parseStoredMediaRef(v, defaultBucket);
    if (parsed.kind === 'absolute') {
      setSigned(parsed.url);
      return;
    }
    if (!parsed.path && !isStorageObjectPath(v)) {
      setSigned(null);
      return;
    }

    void resolveSignedMediaUrl(
      supabase.storage,
      defaultBucket,
      v,
      expiresIn,
    )
      .then((url) => {
        if (!cancelled) setSigned(url);
      })
      .catch(() => {
        if (!cancelled) setSigned(null);
      });

    return () => {
      cancelled = true;
    };
  }, [pathOrUrl, defaultBucket, expiresIn]);

  return signed;
}

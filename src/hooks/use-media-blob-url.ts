"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isProxiedMediaUrl, loadMediaBlob } from "@/lib/media/blob-cache";
import { storageBucket } from "@/lib/supabase/config";
import {
  DISPLAY_SIGNED_URL_TTL_SEC,
  isHttpUrl,
  isStorageObjectPath,
  resolveSignedMediaUrl,
} from "@/lib/storage/signed-url";

export type MediaLoadStatus = "idle" | "loading" | "ready" | "error";

interface MediaBlobUrlState {
  /** Ready-to-render URL: the original for public media, an object URL for proxied. */
  src: string | null;
  status: MediaLoadStatus;
}

/** A settled load, tagged with the URL it belongs to. */
interface ResolvedMedia {
  url: string;
  objectUrl: string | null;
  /** Absolute http(s) URL used when signing (non-proxy private bucket). */
  signedUrl: string | null;
  failed: boolean;
}

function needsClientSign(url: string): boolean {
  if (isProxiedMediaUrl(url) || url.startsWith("/api/")) return false;
  if (isStorageObjectPath(url)) return true;
  // Legacy public Supabase object URLs — buckets are now private.
  return isHttpUrl(url) && url.includes("/storage/v1/object/");
}

/**
 * Resolve a `messages.media_url` into something an `<img>` can render.
 *
 * - Inbound `/api/whatsapp/media/*` → credentialed blob (cached).
 * - Storage object paths / legacy public bucket URLs → short-lived signed URL.
 * - Other absolute https URLs → handed straight back.
 *
 * Only use this for images. Video and audio must keep a plain URL so
 * the element streams instead of buffering up to 16 MB before it plays
 * (see `useSignedStorageUrl` for those).
 */
export function useMediaBlobUrl(url: string | undefined): MediaBlobUrlState {
  const [resolved, setResolved] = useState<ResolvedMedia | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    const run = async () => {
      try {
        let fetchUrl = url;
        if (needsClientSign(url)) {
          const supabase = createClient();
          fetchUrl = await resolveSignedMediaUrl(
            supabase.storage,
            storageBucket("chat-media"),
            url,
            DISPLAY_SIGNED_URL_TTL_SEC,
          );
          if (cancelled) return;
          // Signed https — browser can fetch/cache directly.
          setResolved({
            url,
            objectUrl: null,
            signedUrl: fetchUrl,
            failed: false,
          });
          return;
        }

        if (!isProxiedMediaUrl(url)) {
          setResolved({
            url,
            objectUrl: null,
            signedUrl: url,
            failed: false,
          });
          return;
        }

        const blob = await loadMediaBlob(url);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved({ url, objectUrl, signedUrl: null, failed: false });
      } catch {
        if (cancelled) return;
        setResolved({
          url,
          objectUrl: null,
          signedUrl: null,
          failed: true,
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url) return { src: null, status: "idle" };

  if (resolved?.url === url) {
    if (resolved.failed) return { src: null, status: "error" };
    return {
      src: resolved.objectUrl ?? resolved.signedUrl,
      status: "ready",
    };
  }

  // Proxied / path refs need an async round-trip.
  if (isProxiedMediaUrl(url) || needsClientSign(url)) {
    return { src: null, status: "loading" };
  }

  // Plain absolute URL — first paint can use it immediately.
  return { src: url, status: "ready" };
}

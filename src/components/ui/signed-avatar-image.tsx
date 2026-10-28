'use client';

import { AvatarImage } from '@/components/ui/avatar';
import { useSignedStorageUrl } from '@/hooks/use-signed-storage-url';
import { storageBucket } from '@/lib/supabase/config';

/**
 * AvatarImage that resolves private-bucket Storage paths (and legacy
 * public object URLs) to short-lived signed URLs. Absolute external
 * URLs pass through unchanged.
 */
export function SignedAvatarImage({
  src,
  alt,
  className,
  bucket = storageBucket('avatars'),
}: {
  src: string;
  alt?: string;
  className?: string;
  bucket?: string;
}) {
  const signed = useSignedStorageUrl(src, bucket);
  if (!signed) return null;
  return <AvatarImage src={signed} alt={alt} className={className} />;
}

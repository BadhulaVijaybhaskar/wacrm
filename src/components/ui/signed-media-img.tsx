'use client';

import { useSignedStorageUrl } from '@/hooks/use-signed-storage-url';
import { storageBucket } from '@/lib/supabase/config';

/** `<img>` that signs private Storage paths before display. */
export function SignedMediaImg({
  src,
  alt,
  className,
  bucket = storageBucket('avatars'),
}: {
  src: string;
  alt: string;
  className?: string;
  bucket?: string;
}) {
  const signed = useSignedStorageUrl(src, bucket);
  if (!signed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={signed} alt={alt} className={className} />;
}

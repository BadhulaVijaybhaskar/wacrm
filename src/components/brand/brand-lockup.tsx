'use client';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

type LockupSize = 275 | 'full';

const LIGHT: Record<LockupSize, string> = {
  275: '/brand/astra-chat-lockup-275.png',
  full: '/brand/astra-chat-lockup.png',
};

const DARK: Record<LockupSize, string> = {
  275: '/brand/astra-chat-lockup-dark-275.png',
  full: '/brand/astra-chat-lockup-dark.png',
};

interface BrandLockupProps {
  /** Prefers the 275px export used on auth + compact chrome. */
  size?: LockupSize;
  width?: number;
  height?: number;
  className?: string;
  alt?: string;
  /**
   * Force the white-wordmark asset (e.g. dark Connect rail, which stays
   * night-coloured in both light and dark page modes).
   */
  forceDark?: boolean;
}

/**
 * Theme-aware Astra Chat wordmark lockup. Mark colours stay official;
 * dark mode swaps to the derived white-wordmark variant.
 */
export function BrandLockup({
  size = 275,
  width = 275,
  height = 65,
  className,
  alt = 'Astra Chat',
  forceDark = false,
}: BrandLockupProps) {
  const { mode } = useTheme();
  const useDark = forceDark || mode === 'dark';
  const src = useDark ? DARK[size] : LIGHT[size];

  return (
    // eslint-disable-next-line @next/next/no-img-element -- brand PNG; theme swaps src
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={cn('h-auto w-auto', className)}
      decoding="async"
    />
  );
}

interface BrandMarkProps {
  size?: number;
  className?: string;
  alt?: string;
}

/** Official AC mark (colours are dark-mode safe). */
export function BrandMark({
  size = 26,
  className,
  alt = '',
}: BrandMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/ac-mark.png"
      alt={alt}
      width={size}
      height={size}
      className={cn('shrink-0 object-contain', className)}
      decoding="async"
    />
  );
}

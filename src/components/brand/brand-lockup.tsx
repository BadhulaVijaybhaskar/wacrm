'use client';

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

export { LIGHT as BRAND_LOCKUP_LIGHT, DARK as BRAND_LOCKUP_DARK };

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
 * Theme-aware Astra Chat wordmark lockup.
 *
 * Both light and dark assets are always in the DOM; visibility is CSS-driven
 * via `html.dark` / `html[data-mode]` (see `app/globals.css`). That avoids a
 * hydration mismatch when the theme-boot script flips mode before React
 * hydrates.
 *
 * Intrinsic PNG size is large (~275×92). Call sites MUST pass a height cap
 * (`h-7`, `acl-lockup`, etc.). The wrapper uses aspect-ratio + overflow;
 * images are absolutely positioned so they cannot spill the header.
 */
export function BrandLockup({
  size = 275,
  width = 275,
  height = 28,
  className,
  alt = 'Astra Chat',
  forceDark = false,
}: BrandLockupProps) {
  if (forceDark) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- brand PNG
      <img
        src={DARK[size]}
        alt={alt}
        width={width}
        height={height}
        className={cn(
          'block h-full max-h-full w-auto max-w-full object-contain object-left',
          className,
        )}
        decoding="async"
      />
    );
  }

  return (
    <span className={cn('brand-lockup', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- brand PNG */}
      <img
        src={LIGHT[size]}
        alt={alt}
        width={width}
        height={height}
        data-brand-lockup="light"
        className="brand-lockup-light brand-lockup-img"
        decoding="async"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- brand PNG */}
      <img
        src={DARK[size]}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        data-brand-lockup="dark"
        className="brand-lockup-dark brand-lockup-img"
        decoding="async"
      />
    </span>
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

/**
 * Resolve the Next.js `metadataBase` used to absolutize relative OG /
 * Twitter / icon URLs.
 *
 * Prefer `NEXT_PUBLIC_SITE_URL` (staging / production). In development
 * only, fall back to the incoming request host so local previews don't
 * hard-code a wrong origin. Never invent a production host from the
 * request — that is how og:image ended up as http://localhost:3000/…
 * on staging when metadataBase was unset.
 */

export type HeaderReader = {
  get(name: string): string | null
}

export function resolveMetadataBase(opts?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  headers?: HeaderReader | null
  nodeEnv?: string
}): URL {
  const env = opts?.env ?? process.env
  const nodeEnv = opts?.nodeEnv ?? env.NODE_ENV ?? process.env.NODE_ENV

  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) {
    return new URL(explicit.replace(/\/+$/, ''))
  }

  if (nodeEnv === 'development' && opts?.headers) {
    const forwardedHost = opts.headers
      .get('x-forwarded-host')
      ?.split(',')[0]
      ?.trim()
    const host = forwardedHost || opts.headers.get('host')?.trim()
    if (host) {
      const proto =
        opts.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
        'http'
      return new URL(`${proto}://${host}`)
    }
  }

  // Build / start without SITE_URL: keep a deterministic local base so
  // Next can still compose relative metadata fields.
  return new URL('http://localhost:3000')
}

/** Compose a relative metadata path the same way Next.js does. */
export function absolutizeMetadataUrl(
  metadataBase: URL,
  relativePath: string,
): string {
  return new URL(relativePath, metadataBase).toString()
}

export const OG_IMAGE_PATH = '/brand/og.png'

/** Absolute og:image for the current site URL configuration. */
export function resolveOgImageUrl(opts?: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  headers?: HeaderReader | null
  nodeEnv?: string
  path?: string
}): string {
  return absolutizeMetadataUrl(
    resolveMetadataBase(opts),
    opts?.path ?? OG_IMAGE_PATH,
  )
}

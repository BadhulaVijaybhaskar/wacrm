import { NextResponse } from 'next/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import {
  mediaSigningSecret,
  verifyMediaToken,
} from '@/lib/astra-connect/media'
import { createServiceClient } from '@/lib/supabase/admin'

export const maxDuration = 30

function supabaseAdmin() {
  return createServiceClient()
}

type Params = { params: Promise<{ token: string }> }

/**
 * GET /api/astra-connect/media/[token]
 *
 * Unauthenticated short-lived media URL for Astra Connect (contract §6).
 * Token is HMAC-signed (~15 min). Streams bytes from chat-media when a
 * durable URL was embedded, otherwise re-fetches from Meta with the
 * account's WABA token.
 */
export async function GET(_request: Request, { params }: Params) {
  const secret = mediaSigningSecret()
  if (!secret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const { token: rawToken } = await params
  const token = decodeURIComponent(rawToken ?? '')
  const payload = verifyMediaToken(token, secret)
  if (!payload) {
    return NextResponse.json({ error: 'invalid_or_expired' }, { status: 401 })
  }

  // Prefer the durable mirrored object when we have a full https URL.
  if (payload.u && /^https:\/\//i.test(payload.u)) {
    try {
      const upstream = await fetch(payload.u, {
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
      })
      if (upstream.ok && upstream.body) {
        const headers = new Headers()
        const ct =
          payload.t ||
          upstream.headers.get('content-type') ||
          'application/octet-stream'
        headers.set('Content-Type', ct)
        headers.set('Cache-Control', 'private, max-age=60')
        return new NextResponse(upstream.body, { status: 200, headers })
      }
    } catch (err) {
      console.warn(
        '[astra-connect/media] durable fetch failed, falling back to Meta:',
        err instanceof Error ? err.message : err
      )
    }
  }

  // Fall back to Meta via the account's access token.
  try {
    const { data: config, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', payload.a)
      .maybeSingle()
    if (error || !config?.access_token) {
      return NextResponse.json({ error: 'account_not_found' }, { status: 404 })
    }
    const accessToken = decrypt(config.access_token)
    const info = await getMediaUrl({
      mediaId: payload.m,
      accessToken,
    })
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: info.url,
      accessToken,
    })
    const headers = new Headers()
    headers.set(
      'Content-Type',
      payload.t || contentType || info.mimeType || 'application/octet-stream'
    )
    headers.set('Cache-Control', 'private, max-age=60')
    return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
  } catch (err) {
    console.error(
      '[astra-connect/media] Meta fetch failed:',
      err instanceof Error ? err.message : err
    )
    return NextResponse.json({ error: 'fetch_failed' }, { status: 502 })
  }
}

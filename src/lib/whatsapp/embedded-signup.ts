/**
 * WhatsApp Embedded Signup scaffolding.
 *
 * Gated by WHATSAPP_EMBEDDED_SIGNUP=1. When META_STUB=1 the code exchange
 * returns stable fake numeric WABA / phone IDs and never calls Meta.
 * Real Graph exchange is scaffolding only — unit tests must stay on the
 * stub path (or inject fetchFn that never hits the network).
 */

import { isNumericMetaId } from '@/lib/whatsapp/waba-pairing'

const META_API_VERSION = 'v21.0'
const META_OAUTH_URL = `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`

/** Stable digit-only stubs — pass `isNumericMetaId`. */
export const STUB_WABA_ID = '900000000000001'
export const STUB_PHONE_NUMBER_ID = '900000000000002'
export const STUB_ACCESS_TOKEN = 'stub-embedded-signup-token'

function envFlagOn(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function isEmbeddedSignupEnabled(): boolean {
  return process.env.WACRM_EMBEDDED_SIGNUP !== '1' && envFlagOn('WHATSAPP_EMBEDDED_SIGNUP')
}

export function isMetaStubMode(): boolean {
  return envFlagOn('META_STUB')
}

export function embeddedSignupAppId(): string | null {
  const id = process.env.META_APP_ID?.trim()
  return id || null
}

export interface EmbeddedSignupResult {
  waba_id: string
  phone_number_id: string
  access_token: string
  stub: boolean
}

export class EmbeddedSignupError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'EmbeddedSignupError'
    this.status = status
  }
}

/**
 * Exchange an Embedded Signup OAuth `code` for WABA + phone IDs.
 *
 * Stub mode ignores the code and returns fixed fake IDs.
 * Live mode exchanges the code for a business token and requires the
 * client-supplied `waba_id` / `phone_number_id` from the signup session
 * (FB JS SDK sessionInfoListener). Optional `fetchFn` is for tests only.
 */
export async function exchangeEmbeddedSignupCode(args: {
  code: string
  wabaId?: string | null
  phoneNumberId?: string | null
  fetchFn?: typeof fetch
}): Promise<EmbeddedSignupResult> {
  const code = args.code?.trim()
  if (!code) {
    throw new EmbeddedSignupError('code is required')
  }

  if (isMetaStubMode()) {
    return {
      waba_id: STUB_WABA_ID,
      phone_number_id: STUB_PHONE_NUMBER_ID,
      access_token: STUB_ACCESS_TOKEN,
      stub: true,
    }
  }

  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.split(',')[0]?.trim()
  if (!appId || !appSecret) {
    throw new EmbeddedSignupError(
      'META_APP_ID and META_APP_SECRET are required for Embedded Signup',
      503,
    )
  }

  const wabaId = args.wabaId?.trim() || null
  const phoneNumberId = args.phoneNumberId?.trim() || null
  if (!wabaId || !phoneNumberId) {
    throw new EmbeddedSignupError(
      'waba_id and phone_number_id from the signup session are required',
    )
  }
  if (!isNumericMetaId(wabaId) || !isNumericMetaId(phoneNumberId)) {
    throw new EmbeddedSignupError('waba_id and phone_number_id must be numeric')
  }

  const fetchFn = args.fetchFn ?? fetch
  const url = new URL(META_OAUTH_URL)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('code', code)

  const res = await fetchFn(url.toString(), { method: 'GET', redirect: 'error' })
  const payload = (await res.json().catch(() => null)) as {
    access_token?: string
    error?: { message?: string }
  } | null

  if (!res.ok || !payload?.access_token) {
    const detail =
      typeof payload?.error?.message === 'string'
        ? payload.error.message
        : `Meta OAuth exchange failed (${res.status})`
    throw new EmbeddedSignupError(detail, 502)
  }

  return {
    waba_id: wabaId,
    phone_number_id: phoneNumberId,
    access_token: payload.access_token,
    stub: false,
  }
}

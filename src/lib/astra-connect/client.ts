/**
 * HTTP client for Astra Connect adapter endpoints.
 *
 * Policy (contract §8):
 *   - 30 s timeout
 *   - one retry on network error or 5xx (same message_id / body)
 *   - on 429 with Retry-After: wait and resend with the same body
 *   - 4xx (except 429 / 409) are final — do not retry
 *   - 409 in_progress: brief wait, one more attempt
 */

import { astraAuthHeaders } from './sign'
import {
  adapterSecret,
  connectAdapterBaseUrl,
} from './config'
import type { AstraAdapterResult } from './types'

export const ADAPTER_TIMEOUT_MS = 30_000
/** Cap how long we sleep on 429 so we stay inside the webhook `after()` budget. */
export const MAX_RETRY_AFTER_WAIT_MS = 55_000
const IN_PROGRESS_WAIT_MS = 2_000

export interface PostOptions {
  /** Absolute or path under CONNECT_ADAPTER_URL. */
  path: string
  /** Already-serialized JSON body — signed as-is, never re-serialized. */
  rawBody: string
  /** Override secret (tests / future per-account secret). */
  secret?: string
  /** Override base URL (tests). */
  baseUrl?: string
  /** Injected clock / sleep / fetch for tests. */
  nowSeconds?: () => number
  sleep?: (ms: number) => Promise<void>
  fetchFn?: typeof fetch
  timeoutMs?: number
  /** When false, skip the automatic 5xx/network retry (default true). */
  retryOnServerError?: boolean
  /** When false, skip the 429 wait+retry (default true). */
  retryOnRateLimit?: boolean
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 60
  const asInt = Number(header)
  if (Number.isFinite(asInt) && asInt >= 0) return asInt
  const when = Date.parse(header)
  if (Number.isFinite(when)) {
    return Math.max(0, Math.ceil((when - Date.now()) / 1000))
  }
  return 60
}

async function fetchOnce(
  url: string,
  rawBody: string,
  headers: Record<string, string>,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<{ response?: Response; error?: Error }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
      redirect: 'error',
    })
    return { response }
  } catch (err) {
    const error =
      err instanceof Error
        ? err.name === 'AbortError'
          ? Object.assign(new Error('adapter request timed out'), {
              code: 'timeout',
            })
          : err
        : new Error(String(err))
    return { error }
  } finally {
    clearTimeout(timer)
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

/**
 * POST a pre-serialized JSON body to Connect with HMAC auth + retries.
 * Callers must `JSON.stringify` exactly once and pass that string so the
 * signature covers the bytes on the wire.
 */
export async function postSignedJson<T>(
  options: PostOptions
): Promise<AstraAdapterResult<T>> {
  const baseUrl = (options.baseUrl ?? connectAdapterBaseUrl())?.replace(
    /\/+$/,
    ''
  )
  const secret = options.secret ?? adapterSecret()
  if (!baseUrl || !secret) {
    return {
      ok: false,
      code: 'not_configured',
      message:
        'CONNECT_ADAPTER_URL and WACRM_ADAPTER_SECRET must be set (secret ≥ 16 chars)',
    }
  }

  const path = options.path.startsWith('/')
    ? options.path
    : `/${options.path}`
  const url = `${baseUrl}${path}`
  const timeoutMs = options.timeoutMs ?? ADAPTER_TIMEOUT_MS
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const nowSeconds =
    options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const retryOnServerError = options.retryOnServerError !== false
  const retryOnRateLimit = options.retryOnRateLimit !== false

  const attempt = async (): Promise<AstraAdapterResult<T>> => {
    const ts = nowSeconds()
    const headers = astraAuthHeaders(options.rawBody, secret, ts)
    const { response, error } = await fetchOnce(
      url,
      options.rawBody,
      headers,
      timeoutMs,
      fetchFn
    )

    if (error) {
      const isTimeout =
        (error as { code?: string }).code === 'timeout' ||
        error.name === 'AbortError' ||
        /timed out/i.test(error.message)
      return {
        ok: false,
        code: isTimeout ? 'timeout' : 'network_error',
        message: error.message,
      }
    }

    const res = response!
    const data = await readJsonBody(res)

    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, data: data as T }
    }

    if (res.status === 429) {
      return {
        ok: false,
        code: 'rate_limited',
        status: 429,
        body: data,
        retryAfterSeconds: parseRetryAfter(res.headers.get('Retry-After')),
        message: 'rate_limited',
      }
    }

    if (res.status === 409) {
      return {
        ok: false,
        code: 'in_progress',
        status: 409,
        body: data,
        message: 'in_progress',
      }
    }

    if (res.status >= 500) {
      return {
        ok: false,
        code: 'http_error',
        status: res.status,
        body: data,
        message: `Connect returned ${res.status}`,
      }
    }

    return {
      ok: false,
      code: 'final_client_error',
      status: res.status,
      body: data,
      message: `Connect returned ${res.status}`,
    }
  }

  let result = await attempt()

  // One retry on network / timeout / 5xx.
  if (
    retryOnServerError &&
    !result.ok &&
    (result.code === 'network_error' ||
      result.code === 'timeout' ||
      (result.code === 'http_error' && (result.status ?? 0) >= 500))
  ) {
    result = await attempt()
  }

  // 409 in_progress — brief wait, one more try (contract §8).
  if (!result.ok && result.code === 'in_progress') {
    await sleep(IN_PROGRESS_WAIT_MS)
    result = await attempt()
  }

  // 429 — queue (wait Retry-After) and resend with the same body.
  if (retryOnRateLimit && !result.ok && result.code === 'rate_limited') {
    const waitMs = Math.min(
      (result.retryAfterSeconds ?? 60) * 1000,
      MAX_RETRY_AFTER_WAIT_MS
    )
    await sleep(waitMs)
    result = await attempt()
  }

  return result
}

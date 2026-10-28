/**
 * Connect employee WhatsApp channel on/off gate.
 *
 * When Astra Connect is active for an account (4a switch on + tenant +
 * secret), every wacrm-originated Meta send must check
 * `channels.whatsapp` for that employee. Connect already refuses inbound
 * / AI when the switch is off; this keeps outbound in lockstep.
 *
 * Standalone mode (Connect integration off) skips the check entirely.
 *
 * Contract: Astraconnect `docs/wacrm-adapter-contract.md` §2a
 * (GET /api/channels/whatsapp/channel-status, canonical-string HMAC).
 */

import {
  isAstraConnectActive,
  loadAstraConnectAccountConfig,
  connectAdapterBaseUrl,
  resolveAccountAdapterSecret,
  type AdapterConfigDb,
} from './config'
import { buildAstraSignature } from './sign'
import { ADAPTER_TIMEOUT_MS } from './client'

/**
 * Path under CONNECT_ADAPTER_URL. Constant so it can flip once if
 * Connect renames the route — signing + request must stay in lockstep.
 */
export const CONNECT_WHATSAPP_CHANNEL_STATUS_PATH =
  '/api/channels/whatsapp/channel-status'

export const CHANNEL_STATUS_CACHE_TTL_MS = 30_000

export type ChannelGateCode =
  | 'channel_disabled'
  | 'channel_not_linked'
  | 'channel_status_unavailable'

export class ChannelGateError extends Error {
  readonly code: ChannelGateCode
  readonly employeeId: string | null

  constructor(
    code: ChannelGateCode,
    message: string,
    employeeId: string | null = null,
  ) {
    super(message)
    this.name = 'ChannelGateError'
    this.code = code
    this.employeeId = employeeId
  }
}

export interface ChannelStatusResult {
  enabled: boolean
  employee_id: string | null
}

type CacheEntry = {
  value: ChannelStatusResult
  expiresAt: number
}

const statusCache = new Map<string, CacheEntry>()

function cacheKey(tenantId: string, phoneNumberId: string): string {
  return `${tenantId}::${phoneNumberId}`
}

/** Test seam — drop the in-memory cache. */
export function __resetChannelStatusCacheForTests(): void {
  statusCache.clear()
}

export function __peekChannelStatusCacheSizeForTests(): number {
  return statusCache.size
}

/**
 * §2a canonical string. Params always in this order, encodeURIComponent,
 * no extras. Signed as `timestamp + "." + canonical` (same as body HMAC
 * helpers, with the canonical standing in for the body).
 */
export function buildChannelStatusCanonical(
  tenantId: string,
  phoneNumberId: string,
  path: string = CONNECT_WHATSAPP_CHANNEL_STATUS_PATH,
): string {
  const pathWithSlash = path.startsWith('/') ? path : `/${path}`
  return (
    `GET ${pathWithSlash}?tenant_id=` +
    encodeURIComponent(tenantId) +
    `&phone_number_id=` +
    encodeURIComponent(phoneNumberId)
  )
}

/** Query string matching the §2a canonical (order + encoding). */
export function buildChannelStatusQuery(
  tenantId: string,
  phoneNumberId: string,
): string {
  return (
    `tenant_id=${encodeURIComponent(tenantId)}` +
    `&phone_number_id=${encodeURIComponent(phoneNumberId)}`
  )
}

export interface FetchChannelStatusOptions {
  tenantId: string
  phoneNumberId: string
  secret: string
  baseUrl?: string | null
  path?: string
  timeoutMs?: number
  fetchFn?: typeof fetch
  nowMs?: () => number
  /** Skip cache read/write (tests). */
  bypassCache?: boolean
}

/**
 * GET Connect channel-status with §2a Astra HMAC over the canonical
 * request string (not an empty body).
 */
export async function fetchWhatsAppChannelStatus(
  options: FetchChannelStatusOptions,
): Promise<ChannelStatusResult> {
  const tenantId = options.tenantId.trim()
  const phoneNumberId = options.phoneNumberId.trim()
  if (!tenantId || !phoneNumberId) {
    throw new ChannelGateError(
      'channel_status_unavailable',
      'tenant_id and phone_number_id are required for channel status',
    )
  }

  const nowMs = options.nowMs ?? Date.now
  const key = cacheKey(tenantId, phoneNumberId)
  if (!options.bypassCache) {
    const hit = statusCache.get(key)
    if (hit && hit.expiresAt > nowMs()) {
      return hit.value
    }
  }

  const base = (options.baseUrl ?? connectAdapterBaseUrl())?.replace(
    /\/+$/,
    '',
  )
  if (!base) {
    throw new ChannelGateError(
      'channel_status_unavailable',
      'CONNECT_ADAPTER_URL is not configured',
    )
  }

  const path = options.path ?? CONNECT_WHATSAPP_CHANNEL_STATUS_PATH
  const pathWithSlash = path.startsWith('/') ? path : `/${path}`
  const query = buildChannelStatusQuery(tenantId, phoneNumberId)
  const url = `${base}${pathWithSlash}?${query}`

  const canonical = buildChannelStatusCanonical(tenantId, phoneNumberId, path)
  const ts = Math.floor(nowMs() / 1000)
  const headers: Record<string, string> = {
    'X-Astra-Timestamp': String(ts),
    'X-Astra-Signature': buildAstraSignature(canonical, options.secret, ts),
  }

  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? ADAPTER_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    // Single attempt — never retry 429/5xx (don't hammer Connect).
    response = await fetchFn(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'error',
    })
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'AbortError' || /timed out/i.test(err.message))
    throw new ChannelGateError(
      'channel_status_unavailable',
      isTimeout
        ? 'Connect channel-status timed out'
        : err instanceof Error
          ? err.message
          : 'Connect channel-status network error',
    )
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 404) {
    // §2a: 404 not_found — no employee owns this number in the tenant.
    throw new ChannelGateError(
      'channel_not_linked',
      'No Connect employee is linked to this WhatsApp number',
    )
  }

  if (!response.ok) {
    // 401 signature_*, 429 rate_limited, 503 not_configured, … → unavailable.
    const retryAfter = response.headers.get('Retry-After')
    const detail =
      response.status === 429 && retryAfter
        ? `Connect channel-status returned 429 (Retry-After: ${retryAfter})`
        : `Connect channel-status returned ${response.status}`
    throw new ChannelGateError('channel_status_unavailable', detail)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ChannelGateError(
      'channel_status_unavailable',
      'Connect channel-status returned invalid JSON',
    )
  }

  const row = data as { enabled?: unknown; employee_id?: unknown }
  if (typeof row.enabled !== 'boolean') {
    throw new ChannelGateError(
      'channel_status_unavailable',
      'Connect channel-status missing enabled:boolean',
    )
  }

  const result: ChannelStatusResult = {
    enabled: row.enabled,
    employee_id:
      typeof row.employee_id === 'string' && row.employee_id.trim()
        ? row.employee_id.trim()
        : null,
  }

  // Cache only successful 200 bodies (enabled true or false).
  if (!options.bypassCache) {
    statusCache.set(key, {
      value: result,
      expiresAt: nowMs() + CHANNEL_STATUS_CACHE_TTL_MS,
    })
  }

  return result
}

/** Structured usage/ops log for a blocked outbound send. */
export function logChannelGateBlock(args: {
  accountId: string
  phoneNumberId: string
  code: ChannelGateCode
  detail?: string
  employeeId?: string | null
}): void {
  console.warn(
    JSON.stringify({
      type: 'whatsapp.channel_gate',
      account_id: args.accountId,
      phone_number_id: args.phoneNumberId,
      code: args.code,
      detail: args.detail ?? null,
      employee_id: args.employeeId ?? null,
      at: new Date().toISOString(),
    }),
  )
}

/**
 * Low-level gate: always consults Connect for the given tenant + phone.
 * Callers that need standalone bypass should use
 * {@link assertWhatsAppChannelEnabledForAccount}.
 *
 * Fail closed: only `200 {enabled:true}` allows a send.
 */
export async function assertWhatsAppChannelEnabled(args: {
  tenantId: string
  phoneNumberId: string
  secret: string
  baseUrl?: string | null
  path?: string
  timeoutMs?: number
  fetchFn?: typeof fetch
  nowMs?: () => number
  bypassCache?: boolean
}): Promise<ChannelStatusResult> {
  const status = await fetchWhatsAppChannelStatus(args)
  if (!status.enabled) {
    throw new ChannelGateError(
      'channel_disabled',
      'WhatsApp channel is disabled for this Connect employee',
      status.employee_id,
    )
  }
  return status
}

export interface AssertForAccountOptions {
  accountId: string
  phoneNumberId: string
  db?: AdapterConfigDb
  fetchFn?: typeof fetch
  nowMs?: () => number
  bypassCache?: boolean
  timeoutMs?: number
  /** Injected config loader (tests). */
  loadConfig?: typeof loadAstraConnectAccountConfig
}

/**
 * Account-scoped gate used by Meta send helpers.
 *
 * - Connect integration off (4a) → no-op (standalone behaviour).
 * - Connect on + enabled:false → channel_disabled.
 * - Connect on + 404 → channel_not_linked (no employee owns the number).
 * - Connect on + 401/429/503/timeout/other → channel_status_unavailable.
 */
export async function assertWhatsAppChannelEnabledForAccount(
  options: AssertForAccountOptions,
): Promise<{ skipped: true } | ChannelStatusResult> {
  const load = options.loadConfig ?? loadAstraConnectAccountConfig
  // Lazy import keeps this module usable in tests that don't boot admin.
  const db =
    options.db ??
    (await import('@/lib/supabase/admin')).createServiceClient()
  const account = await load(db, options.accountId)

  if (!isAstraConnectActive(account)) {
    return { skipped: true }
  }

  const secret = resolveAccountAdapterSecret(account)
  if (!secret || !account) {
    // isAstraConnectActive should have caught this; fail closed anyway.
    throw new ChannelGateError(
      'channel_status_unavailable',
      'Connect adapter secret unavailable',
    )
  }

  return assertWhatsAppChannelEnabled({
    tenantId: account.tenantId,
    phoneNumberId: options.phoneNumberId || account.phoneNumberId,
    secret,
    fetchFn: options.fetchFn,
    nowMs: options.nowMs,
    bypassCache: options.bypassCache,
    timeoutMs: options.timeoutMs,
  })
}

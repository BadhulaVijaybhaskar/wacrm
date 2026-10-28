/**
 * Connect employee WhatsApp channel on/off gate.
 *
 * When Astra Connect is active for an account (4a switch on + tenant +
 * secret), every wacrm-originated Meta send must check
 * `channels.whatsapp` for that employee. Connect already refuses inbound
 * / AI when the switch is off; this keeps outbound in lockstep.
 *
 * Standalone mode (Connect integration off) skips the check entirely.
 */

import {
  isAstraConnectActive,
  loadAstraConnectAccountConfig,
  connectAdapterBaseUrl,
  resolveAccountAdapterSecret,
  type AdapterConfigDb,
} from './config'
import { astraAuthHeaders } from './sign'
import { ADAPTER_TIMEOUT_MS } from './client'

/**
 * Path under CONNECT_ADAPTER_URL. Kept as a constant so it can flip
 * once Connect confirms the final route (e.g. under /api/channels/…).
 */
export const CONNECT_WHATSAPP_CHANNEL_STATUS_PATH =
  '/whatsapp/channel-status'

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
 * GET Connect channel-status with Astra HMAC (empty body, same signing
 * as the v1 contract: `${timestamp}.${rawBody}`).
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
  const qs = new URLSearchParams({
    tenant_id: tenantId,
    phone_number_id: phoneNumberId,
  })
  const url = `${base}${pathWithSlash}?${qs.toString()}`

  // GET: signed message is `${timestamp}.` + empty body (v1 contract).
  const rawBody = ''
  const ts = Math.floor(nowMs() / 1000)
  const headers = astraAuthHeaders(rawBody, options.secret, ts)
  // astraAuthHeaders sets Content-Type: application/json — fine for GET.

  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? ADAPTER_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
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
    // Confirmed Connect contract: 404 = no employee owns this
    // phone_number_id in the tenant → treat as blocked.
    throw new ChannelGateError(
      'channel_not_linked',
      'No Connect employee is linked to this WhatsApp number',
    )
  }

  if (!response.ok) {
    throw new ChannelGateError(
      'channel_status_unavailable',
      `Connect channel-status returned ${response.status}`,
    )
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
 * - Connect on + error/timeout → channel_status_unavailable (fail closed).
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

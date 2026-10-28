/**
 * Server-to-server auth for Connect → Chat read/handoff API.
 *
 * Headers:
 *   X-Astra-Timestamp: <unix seconds>
 *   X-Astra-Signature: sha256=<hex>   (lowercase or uppercase hex)
 *   X-Astra-Tenant: <tenant_id>       (required on every v1 call)
 *
 * Signed message (matches Connect console client Astraconnect 647b711):
 *   GET/HEAD: `${timestamp}.${pathname}${search}.${tenant}`
 *   POST/…:   `${timestamp}.${rawBody}.${tenant}`
 * where `tenant` is the X-Astra-Tenant header value (must match query/body
 * tenant_id). HMAC-SHA256 hex as `X-Astra-Signature: sha256=<hex>`, 300s window.
 *
 * Auth order (fail closed before DB when possible):
 *   1. Structural header checks (missing tenant → 400; missing sig headers → 401)
 *   2. Timestamp window → 401
 *   3. HMAC against global WACRM_ADAPTER_SECRET (no DB). If that fails and
 *      CHAT-05 per-tenant secrets are enabled, look up the tenant secret.
 *   4. Resolve tenant → account in DB
 *
 * DB/config failures → 503 `{ code: 'upstream_unavailable' }` + Retry-After.
 * Unknown tenant / cross-tenant probe → 404 (never reveal existence).
 */

import { NextResponse } from 'next/server'
import {
  isAstraTimestampInWindow,
  verifyAstraHmac,
  verifyAstraSignature,
} from './sign'
import { createServiceClient, __resetServiceClientForTests } from '@/lib/supabase/admin'
import {
  resolveAdapterSecrets,
  type StoredAdapterSecrets,
} from './secrets'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

/** Read endpoints (conversations / messages): 600/min per tenant. */
export const CONNECT_READ_RATE = { limit: 600, windowMs: 60_000 } as const
/** Takeover / handback: 120/min per tenant. */
export const CONNECT_HANDOFF_RATE = { limit: 120, windowMs: 60_000 } as const
/** 304 Not Modified responses consume a quarter of a read unit. */
export const CONNECT_READ_NOT_MODIFIED_COST = 0.25

/** Retry-After for Connect when Supabase/config is unavailable. */
export const UPSTREAM_RETRY_AFTER_SECONDS = 30

export class UpstreamUnavailableError extends Error {
  readonly code = 'upstream_unavailable' as const
  constructor(message = 'Upstream unavailable') {
    super(message)
    this.name = 'UpstreamUnavailableError'
  }
}

export function isUpstreamUnavailable(err: unknown): boolean {
  return (
    err instanceof UpstreamUnavailableError ||
    (typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === 'upstream_unavailable')
  )
}

export function upstreamUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Upstream unavailable', code: 'upstream_unavailable' },
    {
      status: 503,
      headers: {
        'Retry-After': String(UPSTREAM_RETRY_AFTER_SECONDS),
      },
    },
  )
}

/**
 * CHAT-05 per-tenant encrypted secrets require ENCRYPTION_KEY to decrypt.
 * When unset, auth uses only the global WACRM_ADAPTER_SECRET (no secret DB).
 */
export function perTenantSecretsEnabled(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY?.trim())
}

function globalAdapterSecret(): string | null {
  const global = process.env.WACRM_ADAPTER_SECRET?.trim()
  if (global && global.length >= 16) return global
  return null
}

export function __resetConnectReadAdminForTests() {
  __resetServiceClientForTests()
}

export function connectReadAdmin() {
  try {
    return createServiceClient()
  } catch {
    throw new UpstreamUnavailableError(
      'Supabase admin credentials not configured',
    )
  }
}

export type ConnectTenantContext = {
  accountId: string
  tenantId: string
  phoneNumberId: string | null
  employeeId: string | null
  /** Per-account Connect adapter switch (Settings → Astra Connect). */
  enabled: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
}

export type ConnectRateBucket = 'read' | 'handoff' | 'none'

/**
 * Build the payload portion of the HMAC signed string (everything after
 * `${timestamp}.`).
 *
 * GET/HEAD: `${pathname}${search}.${tenant}`
 * POST/…:   `${rawBody}.${tenant}`
 *
 * `tenant` is the X-Astra-Tenant header value.
 */
export function connectSignedPayload(
  request: Request,
  rawBody: string,
  tenantId?: string,
): string {
  const tenant = (tenantId ?? '').trim()
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    const url = new URL(request.url)
    const pathAndQuery = `${url.pathname}${url.search}`
    return tenant ? `${pathAndQuery}.${tenant}` : pathAndQuery
  }
  return tenant ? `${rawBody}.${tenant}` : rawBody
}

export function readAstraHeaders(request: Request): {
  timestamp: number
  signature: string
} | null {
  const tsRaw = request.headers.get('x-astra-timestamp')
  const signature = request.headers.get('x-astra-signature')
  if (!tsRaw || !signature) return null
  const timestamp = Number(tsRaw)
  if (!Number.isFinite(timestamp)) return null
  return { timestamp, signature }
}

export function readAstraTenantHeader(request: Request): string | null {
  const raw = request.headers.get('x-astra-tenant')
  if (raw == null) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function verifyConnectRequest(args: {
  signature: string
  payload: string
  timestamp: number
  secrets: string[]
  nowSeconds?: number
}): boolean {
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  for (const secret of args.secrets) {
    if (
      verifyAstraSignature(
        args.signature,
        args.payload,
        secret,
        args.timestamp,
        now,
      )
    ) {
      return true
    }
  }
  return false
}

function verifyHmacWithSecrets(
  signature: string,
  payload: string,
  timestamp: number,
  secrets: string[],
): boolean {
  for (const secret of secrets) {
    if (verifyAstraHmac(signature, payload, secret, timestamp)) return true
  }
  return false
}

/**
 * Resolve tenant → account from whatsapp_config.astra_connect_tenant_id.
 * Returns null when unknown (callers map to 404).
 * Throws UpstreamUnavailableError on DB/config failures.
 */
export async function loadTenantByConnectId(
  tenantId: string,
): Promise<ConnectTenantContext | null> {
  const trimmed = tenantId.trim()
  if (!trimmed) return null
  const db = connectReadAdmin()
  const { data, error } = await db
    .from('whatsapp_config')
    .select(
      'account_id, phone_number_id, astra_connect_tenant_id, astra_employee_id, astra_connect_enabled, astra_connect_secret_encrypted, astra_connect_secret_previous_encrypted, astra_connect_secret_previous_expires_at',
    )
    .eq('astra_connect_tenant_id', trimmed)
    .maybeSingle()

  if (error) {
    throw new UpstreamUnavailableError(
      error.message ?? 'Failed to load Connect tenant',
    )
  }
  if (!data?.account_id) return null

  return {
    accountId: data.account_id as string,
    tenantId: trimmed,
    phoneNumberId:
      typeof data.phone_number_id === 'string' ? data.phone_number_id : null,
    employeeId:
      typeof data.astra_employee_id === 'string' && data.astra_employee_id.trim()
        ? data.astra_employee_id.trim()
        : null,
    enabled: data.astra_connect_enabled === true,
    db,
  }
}

export function tenantSecretsFromRow(row: {
  astra_connect_secret_encrypted?: string | null
  astra_connect_secret_previous_encrypted?: string | null
  astra_connect_secret_previous_expires_at?: string | null
}): string[] {
  const stored: StoredAdapterSecrets = {
    currentEncrypted: row.astra_connect_secret_encrypted ?? null,
    previousEncrypted: row.astra_connect_secret_previous_encrypted ?? null,
    previousExpiresAt: row.astra_connect_secret_previous_expires_at ?? null,
  }
  return resolveAdapterSecrets(stored).accepted
}

async function loadTenantSecretList(
  ctx: ConnectTenantContext,
): Promise<string[]> {
  const { data, error } = await ctx.db
    .from('whatsapp_config')
    .select(
      'astra_connect_secret_encrypted, astra_connect_secret_previous_encrypted, astra_connect_secret_previous_expires_at',
    )
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  if (error) {
    throw new UpstreamUnavailableError(
      error.message ?? 'Failed to load Connect tenant secrets',
    )
  }
  return tenantSecretsFromRow(data ?? {})
}

export function consumeConnectRateLimit(args: {
  tenantId: string
  bucket: Exclude<ConnectRateBucket, 'none'>
  cost?: number
}): ReturnType<typeof checkRateLimit> {
  const rate =
    args.bucket === 'handoff' ? CONNECT_HANDOFF_RATE : CONNECT_READ_RATE
  return checkRateLimit(
    `astra-connect-${args.bucket}:${args.tenantId}`,
    rate,
    args.cost ?? 1,
  )
}

/**
 * Authenticate a Connect v1 request.
 *
 * Callers must validate query/body with zod **before** this (step 1 of the
 * public contract). This function then: timestamp → HMAC → DB.
 *
 * @param rateLimit When `'none'`, skip rate limiting (caller charges after
 *   knowing whether the response is 200 vs 304). Default `'read'`.
 */
export async function authenticateConnectRequest(args: {
  request: Request
  tenantId: string
  rawBody?: string
  rateLimit?: ConnectRateBucket
}): Promise<
  | { ok: true; ctx: ConnectTenantContext }
  | { ok: false; response: NextResponse }
> {
  const headerTenant = readAstraTenantHeader(args.request)
  if (!headerTenant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing X-Astra-Tenant' },
        { status: 400 },
      ),
    }
  }

  const queryOrBodyTenant = args.tenantId.trim()
  if (!queryOrBodyTenant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'tenant_id is required' },
        { status: 400 },
      ),
    }
  }

  // Cross-tenant probe: header disagrees with query/body → 404 (never 403).
  // No DB — does not reveal whether either tenant exists.
  if (headerTenant !== queryOrBodyTenant) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }

  const headers = readAstraHeaders(args.request)
  if (!headers) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Missing X-Astra-Timestamp or X-Astra-Signature' },
        { status: 401 },
      ),
    }
  }

  // 2. Timestamp window — before HMAC and before any DB work.
  const now = Math.floor(Date.now() / 1000)
  if (!isAstraTimestampInWindow(headers.timestamp, now)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid or expired timestamp' },
        { status: 401 },
      ),
    }
  }

  const payload = connectSignedPayload(
    args.request,
    args.rawBody ?? '',
    headerTenant,
  )

  // 3. Global HMAC (no DB). Per-tenant secrets only if global fails/missing
  //    and CHAT-05 decryption is configured.
  const global = globalAdapterSecret()
  let signatureOk = false
  if (global) {
    signatureOk = verifyAstraHmac(
      headers.signature,
      payload,
      global,
      headers.timestamp,
    )
  }

  let ctx: ConnectTenantContext | null = null

  if (!signatureOk && perTenantSecretsEnabled()) {
    try {
      ctx = await loadTenantByConnectId(queryOrBodyTenant)
      if (ctx) {
        const secrets = await loadTenantSecretList(ctx)
        // accepted includes global — but global already failed; still fine.
        signatureOk = verifyHmacWithSecrets(
          headers.signature,
          payload,
          headers.timestamp,
          secrets,
        )
      }
    } catch (err) {
      if (isUpstreamUnavailable(err)) {
        // Global was set and failed: treat as bad signature (do not leak
        // upstream status on an auth failure path). No global → 503.
        if (global) {
          return {
            ok: false,
            response: NextResponse.json(
              { error: 'Invalid signature' },
              { status: 401 },
            ),
          }
        }
        return { ok: false, response: upstreamUnavailableResponse() }
      }
      throw err
    }
  }

  if (!signatureOk) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 },
      ),
    }
  }

  // 4. Signature ok — resolve tenant in DB (if not already loaded).
  if (!ctx) {
    try {
      ctx = await loadTenantByConnectId(queryOrBodyTenant)
    } catch (err) {
      if (isUpstreamUnavailable(err)) {
        return { ok: false, response: upstreamUnavailableResponse() }
      }
      throw err
    }
  }

  if (!ctx) {
    // Valid HMAC but unknown tenant — 404, never 403.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }

  // Per-account off switch (Settings → Astra Connect). Auth succeeded and
  // the tenant exists, but Chat must not serve Connect reads/handoffs.
  if (!ctx.enabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Connect disabled for tenant', code: 'connect_disabled' },
        { status: 403 },
      ),
    }
  }

  const bucket = args.rateLimit ?? 'read'
  if (bucket !== 'none') {
    const limit = consumeConnectRateLimit({
      tenantId: ctx.tenantId,
      bucket,
    })
    if (!limit.success) {
      return { ok: false, response: rateLimitResponse(limit) }
    }
  }

  return { ok: true, ctx }
}

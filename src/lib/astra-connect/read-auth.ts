/**
 * Server-to-server auth for Connect → Chat read/handoff API.
 *
 * Headers:
 *   X-Astra-Timestamp: <unix seconds>
 *   X-Astra-Signature: sha256=<hex>   (lowercase or uppercase hex)
 *
 * Signed message:
 *   POST/PUT/PATCH/DELETE: `${timestamp}.${rawBody}`
 *   GET/HEAD:              `${timestamp}.${pathAndQuery}`
 *     where pathAndQuery is pathname + search (e.g.
 *     `/api/astra-connect/v1/conversations?tenant_id=t1&limit=50`)
 *
 * Secret resolution: per-tenant current (+ previous within 24h rotation
 * window), then global WACRM_ADAPTER_SECRET.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyAstraSignature } from './sign'
import {
  resolveAdapterSecrets,
  type StoredAdapterSecrets,
} from './secrets'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const CONNECT_READ_RATE = { limit: 120, windowMs: 60_000 } as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
export function connectReadAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export type ConnectTenantContext = {
  accountId: string
  tenantId: string
  phoneNumberId: string | null
  employeeId: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
}

export function connectSignedPayload(
  request: Request,
  rawBody: string,
): string {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') {
    const url = new URL(request.url)
    return `${url.pathname}${url.search}`
  }
  return rawBody
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

/**
 * Resolve tenant → account from whatsapp_config.astra_connect_tenant_id.
 * Returns null when unknown (callers map to 404).
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
      'account_id, phone_number_id, astra_connect_tenant_id, astra_employee_id, astra_connect_secret_encrypted, astra_connect_secret_previous_encrypted, astra_connect_secret_previous_expires_at',
    )
    .eq('astra_connect_tenant_id', trimmed)
    .maybeSingle()

  if (error || !data?.account_id) return null

  return {
    accountId: data.account_id as string,
    tenantId: trimmed,
    phoneNumberId:
      typeof data.phone_number_id === 'string' ? data.phone_number_id : null,
    employeeId:
      typeof data.astra_employee_id === 'string' && data.astra_employee_id.trim()
        ? data.astra_employee_id.trim()
        : null,
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

export async function authenticateConnectRequest(args: {
  request: Request
  tenantId: string
  rawBody?: string
}): Promise<
  | { ok: true; ctx: ConnectTenantContext }
  | { ok: false; response: NextResponse }
> {
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

  const ctx = await loadTenantByConnectId(args.tenantId)
  if (!ctx) {
    // Do not reveal whether the tenant exists vs bad auth — 404.
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }

  const { data: secretRow } = await ctx.db
    .from('whatsapp_config')
    .select(
      'astra_connect_secret_encrypted, astra_connect_secret_previous_encrypted, astra_connect_secret_previous_expires_at',
    )
    .eq('account_id', ctx.accountId)
    .maybeSingle()

  const secrets = tenantSecretsFromRow(secretRow ?? {})
  if (secrets.length === 0) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not found' }, { status: 404 }),
    }
  }

  const payload = connectSignedPayload(args.request, args.rawBody ?? '')
  const valid = verifyConnectRequest({
    signature: headers.signature,
    payload,
    timestamp: headers.timestamp,
    secrets,
  })
  if (!valid) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 },
      ),
    }
  }

  const limit = checkRateLimit(
    `astra-connect-read:${ctx.tenantId}`,
    CONNECT_READ_RATE,
  )
  if (!limit.success) {
    return { ok: false, response: rateLimitResponse(limit) }
  }

  return { ok: true, ctx }
}

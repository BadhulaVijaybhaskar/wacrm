/**
 * Connect read-API auth ordering probes (staging f139223 contract).
 *
 * Runs with Supabase env unset to simulate a host that has the global
 * adapter secret but no service-role key. Bad params / stale ts / bad
 * sig / tenant mismatch must not become bare 500s.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { buildAstraSignature } from './sign'
import {
  __resetConnectReadAdminForTests,
  authenticateConnectRequest,
} from './read-auth'

const SECRET = 'test-adapter-secret-16chars!!'
const TENANT = 't_abc'

const createClient = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

function unsetSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  __resetConnectReadAdminForTests()
}

function signedGet(
  pathAndQuery: string,
  opts: {
    tenant?: string
    ts?: number
    signature?: string
    omitTenantHeader?: boolean
  } = {},
) {
  const tenant = opts.tenant ?? TENANT
  const ts = opts.ts ?? Math.floor(Date.now() / 1000)
  const payload = `${pathAndQuery}.${tenant}`
  const sig =
    opts.signature ?? buildAstraSignature(payload, SECRET, ts)
  const headers: Record<string, string> = {
    'X-Astra-Timestamp': String(ts),
    'X-Astra-Signature': sig,
  }
  if (!opts.omitTenantHeader) headers['X-Astra-Tenant'] = tenant
  return new Request(`https://chat.example${pathAndQuery}`, {
    method: 'GET',
    headers,
  })
}

describe('Connect read auth order — Supabase unset', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
    unsetSupabaseEnv()
    createClient.mockReset()
    process.env.WACRM_ADAPTER_SECRET = SECRET
    // ENCRYPTION_KEY stays set via vitest.config — CHAT-05 "enabled",
    // but secret lookup must not run when global HMAC already decides.
  })

  afterEach(() => {
    delete process.env.WACRM_ADAPTER_SECRET
    unsetSupabaseEnv()
    __resetRateLimitForTests()
  })

  it('returns 401 for a bad signature without touching Supabase', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const result = await authenticateConnectRequest({
      request: signedGet(path, {
        signature: 'sha256=' + 'ab'.repeat(32),
      }),
      tenantId: TENANT,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      const body = await result.response.json()
      expect(body.error).toMatch(/signature/i)
    }
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns 401 for a 600s-stale timestamp without touching Supabase', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const stale = Math.floor(Date.now() / 1000) - 600
    const result = await authenticateConnectRequest({
      request: signedGet(path, { ts: stale }),
      tenantId: TENANT,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      const body = await result.response.json()
      expect(body.error).toMatch(/timestamp/i)
    }
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns 404 for tenant header/query mismatch without Supabase', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const result = await authenticateConnectRequest({
      request: signedGet(path, { tenant: 't_other' }),
      tenantId: TENANT,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(404)
      const body = await result.response.json()
      expect(body.error).toBe('Not found')
    }
    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns 503 upstream_unavailable when HMAC ok but Supabase unset', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const result = await authenticateConnectRequest({
      request: signedGet(path),
      tenantId: TENANT,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(503)
      expect(result.response.headers.get('Retry-After')).toBeTruthy()
      const body = await result.response.json()
      expect(body.code).toBe('upstream_unavailable')
    }
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('GET /api/astra-connect/v1/* — Supabase unset route probes', () => {
  beforeEach(() => {
    unsetSupabaseEnv()
    process.env.WACRM_ADAPTER_SECRET = SECRET
  })
  afterEach(() => {
    delete process.env.WACRM_ADAPTER_SECRET
    unsetSupabaseEnv()
  })

  it('limit=abc → 400 before any auth/DB work', async () => {
    const { GET } = await import(
      '@/app/api/astra-connect/v1/conversations/route'
    )
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}&limit=abc`
    const res = await GET(signedGet(path))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/limit/i)
  })

  it('bad signature → 401 (not 500)', async () => {
    const { GET } = await import(
      '@/app/api/astra-connect/v1/conversations/route'
    )
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const res = await GET(
      signedGet(path, { signature: 'sha256=' + 'cd'.repeat(32) }),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).not.toHaveProperty('code', 'upstream_unavailable')
  })

  it('600s-stale timestamp → 401 (not 500)', async () => {
    const { GET } = await import(
      '@/app/api/astra-connect/v1/conversations/route'
    )
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const res = await GET(
      signedGet(path, { ts: Math.floor(Date.now() / 1000) - 600 }),
    )
    expect(res.status).toBe(401)
  })

  it('tenant mismatch → 404 without revealing existence', async () => {
    const { GET } = await import(
      '@/app/api/astra-connect/v1/conversations/route'
    )
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const res = await GET(signedGet(path, { tenant: 't_probe' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('valid HMAC + unset Supabase → 503 upstream_unavailable', async () => {
    const { GET } = await import(
      '@/app/api/astra-connect/v1/conversations/route'
    )
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const res = await GET(signedGet(path))
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    const body = await res.json()
    expect(body.code).toBe('upstream_unavailable')
  })

  it('unknown conversation with unset Supabase → 503 (not bare 500)', async () => {
    const { GET } = await import(
      '@/app/api/astra-connect/v1/conversations/[id]/messages/route'
    )
    const id = '00000000-0000-4000-8000-000000000099'
    const path = `/api/astra-connect/v1/conversations/${id}/messages?tenant_id=${TENANT}`
    const res = await GET(signedGet(path), {
      params: Promise.resolve({ id }),
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.code).toBe('upstream_unavailable')
    expect(res.status).not.toBe(500)
  })
})

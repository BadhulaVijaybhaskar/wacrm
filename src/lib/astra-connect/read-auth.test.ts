import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { buildAstraSignature } from './sign'

const h = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => h.from(...args),
  }),
}))

import {
  __resetConnectReadAdminForTests,
  authenticateConnectRequest,
  consumeConnectRateLimit,
  CONNECT_READ_NOT_MODIFIED_COST,
  CONNECT_READ_RATE,
} from './read-auth'

const SECRET = 'test-adapter-secret-16chars!!'
const TENANT = 't_abc'

function mockTenantRow() {
  h.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => h.maybeSingle(),
      }),
    }),
  }))
  h.maybeSingle.mockResolvedValue({
    data: {
      account_id: 'acct-1',
      phone_number_id: '1065',
      astra_connect_tenant_id: TENANT,
      astra_employee_id: 'emp_1',
      // Secrets resolved via resolveAdapterSecrets — use plaintext path
      // by stubbing accepted secrets through env fallback.
      astra_connect_secret_encrypted: null,
      astra_connect_secret_previous_encrypted: null,
      astra_connect_secret_previous_expires_at: null,
    },
    error: null,
  })
}

function signedGet(pathAndQuery: string, tenant = TENANT) {
  const ts = Math.floor(Date.now() / 1000)
  const payload = `${pathAndQuery}.${tenant}`
  const sig = buildAstraSignature(payload, SECRET, ts)
  return new Request(`https://chat.example${pathAndQuery}`, {
    method: 'GET',
    headers: {
      'X-Astra-Timestamp': String(ts),
      'X-Astra-Signature': sig,
      'X-Astra-Tenant': tenant,
    },
  })
}

describe('authenticateConnectRequest — X-Astra-Tenant', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
    __resetConnectReadAdminForTests()
    process.env.WACRM_ADAPTER_SECRET = SECRET
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
    mockTenantRow()
  })
  afterEach(() => {
    delete process.env.WACRM_ADAPTER_SECRET
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    __resetConnectReadAdminForTests()
    __resetRateLimitForTests()
  })

  it('(b) returns 400 when X-Astra-Tenant is missing', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const ts = Math.floor(Date.now() / 1000)
    const sig = buildAstraSignature(`${path}.${TENANT}`, SECRET, ts)
    const req = new Request(`https://chat.example${path}`, {
      method: 'GET',
      headers: {
        'X-Astra-Timestamp': String(ts),
        'X-Astra-Signature': sig,
      },
    })
    const result = await authenticateConnectRequest({
      request: req,
      tenantId: TENANT,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })

  it('(b) returns 404 when header tenant mismatches query tenant', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const req = signedGet(path, 't_other')
    const result = await authenticateConnectRequest({
      request: req,
      tenantId: TENANT,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(404)
  })

  it('accepts matching header + query with tenant in GET signature', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}&limit=10`
    const result = await authenticateConnectRequest({
      request: signedGet(path),
      tenantId: TENANT,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ctx.tenantId).toBe(TENANT)
  })

  it('accepts POST signed as rawBody.tenant (Astraconnect 647b711)', async () => {
    const raw = JSON.stringify({ tenant_id: TENANT, by: 'ops@acme.com' })
    const ts = Math.floor(Date.now() / 1000)
    const sig = buildAstraSignature(`${raw}.${TENANT}`, SECRET, ts)
    const req = new Request(
      `https://chat.example/api/astra-connect/v1/conversations/c1/takeover`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Astra-Timestamp': String(ts),
          'X-Astra-Signature': sig,
          'X-Astra-Tenant': TENANT,
        },
        body: raw,
      },
    )
    const result = await authenticateConnectRequest({
      request: req,
      tenantId: TENANT,
      rawBody: raw,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(true)
  })

  it('rejects POST signed without the tenant suffix', async () => {
    const raw = JSON.stringify({ tenant_id: TENANT, by: 'ops@acme.com' })
    const ts = Math.floor(Date.now() / 1000)
    const sig = buildAstraSignature(raw, SECRET, ts)
    const req = new Request(
      `https://chat.example/api/astra-connect/v1/conversations/c1/takeover`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Astra-Timestamp': String(ts),
          'X-Astra-Signature': sig,
          'X-Astra-Tenant': TENANT,
        },
        body: raw,
      },
    )
    const result = await authenticateConnectRequest({
      request: req,
      tenantId: TENANT,
      rawBody: raw,
      rateLimit: 'none',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })
})

describe('consumeConnectRateLimit — 304 weight', () => {
  beforeEach(() => __resetRateLimitForTests())
  afterEach(() => __resetRateLimitForTests())

  it('(d) 304 costs a quarter unit against the 600/min read budget', () => {
    // Spend 599 full units, then a 304 should still fit; two more full
    // units would not.
    for (let i = 0; i < 599; i++) {
      const r = consumeConnectRateLimit({ tenantId: 't1', bucket: 'read' })
      expect(r.success).toBe(true)
    }
    const cheap = consumeConnectRateLimit({
      tenantId: 't1',
      bucket: 'read',
      cost: CONNECT_READ_NOT_MODIFIED_COST,
    })
    expect(cheap.success).toBe(true)
    expect(CONNECT_READ_RATE.limit).toBe(600)
    // 599.25 + 1 would exceed 600
    const overflow = consumeConnectRateLimit({
      tenantId: 't1',
      bucket: 'read',
      cost: 1,
    })
    expect(overflow.success).toBe(false)
  })
})

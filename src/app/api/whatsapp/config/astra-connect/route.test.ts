import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  isAdapterEnvConfigured: vi.fn(() => true),
  supabase: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => {
    const message = err instanceof Error ? err.message : 'error'
    return new Response(JSON.stringify({ error: message }), { status: 401 })
  },
}))

vi.mock('@/lib/astra-connect', () => ({
  isAdapterEnvConfigured: h.isAdapterEnvConfigured,
}))

import { GET, PATCH } from './route'

function chain(result: { data: unknown; error: unknown }) {
  const api = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    update: vi.fn(() => api),
    maybeSingle: vi.fn(async () => result),
  }
  return api
}

describe('GET /api/whatsapp/config/astra-connect', () => {
  beforeEach(() => {
    h.requireRole.mockReset().mockResolvedValue({
      supabase: h.supabase,
      accountId: 'acct-1',
    })
    h.isAdapterEnvConfigured.mockReset().mockReturnValue(true)
    h.supabase.from.mockReset()
  })

  it('returns env + account adapter state for admins', async () => {
    h.supabase.from.mockReturnValue(
      chain({
        data: {
          astra_connect_enabled: true,
          astra_connect_tenant_id: 't_abc',
          phone_number_id: '106540352242922',
        },
        error: null,
      }),
    )

    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      env_configured: true,
      enabled: true,
      tenant_id: 't_abc',
      employee_id: null,
      phone_number_id: '106540352242922',
      has_whatsapp_config: true,
      has_secret: false,
      rotation_active: false,
      previous_expires_at: null,
    })
  })

  it('reports env_configured false when global secrets are missing', async () => {
    h.isAdapterEnvConfigured.mockReturnValue(false)
    h.supabase.from.mockReturnValue(
      chain({ data: null, error: null }),
    )
    const res = await GET()
    const body = await res.json()
    expect(body.env_configured).toBe(false)
    expect(body.has_whatsapp_config).toBe(false)
  })
})

describe('PATCH /api/whatsapp/config/astra-connect', () => {
  beforeEach(() => {
    h.requireRole.mockReset().mockResolvedValue({
      supabase: h.supabase,
      accountId: 'acct-1',
    })
    h.isAdapterEnvConfigured.mockReset().mockReturnValue(true)
    h.supabase.from.mockReset()
  })

  it('rejects enabling without a tenant_id', async () => {
    const selectChain = chain({
      data: { astra_connect_tenant_id: null },
      error: null,
    })
    h.supabase.from.mockReturnValue(selectChain)

    const res = await PATCH(
      new Request('http://localhost/api', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/tenant/i)
  })

  it('updates enabled + tenant_id', async () => {
    const updateApi = {
      select: vi.fn(() => updateApi),
      eq: vi.fn(() => updateApi),
      update: vi.fn(() => updateApi),
      maybeSingle: vi.fn(async () => ({
        data: {
          astra_connect_enabled: true,
          astra_connect_tenant_id: 't_new',
          phone_number_id: '106540352242922',
        },
        error: null,
      })),
    }
    h.supabase.from.mockReturnValue(updateApi)

    const res = await PATCH(
      new Request('http://localhost/api', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true, tenant_id: 't_new' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.tenant_id).toBe('t_new')
    expect(updateApi.update).toHaveBeenCalled()
  })
})

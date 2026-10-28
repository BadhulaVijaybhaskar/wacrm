import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  isAdapterEnvConfigured: vi.fn(() => true),
  buildSecretRotationUpdate: vi.fn(() => ({
    astra_connect_secret_encrypted: 'cipher',
    astra_connect_secret_previous_encrypted: null,
    astra_connect_secret_previous_expires_at: null,
  })),
  supabase: { from: vi.fn() },
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

vi.mock('@/lib/astra-connect/secrets', () => ({
  buildSecretRotationUpdate: h.buildSecretRotationUpdate,
}))

import { POST } from './route'

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    update: vi.fn(() => api),
    maybeSingle: vi.fn(async () => result),
  }
  return api
}

describe('POST /api/whatsapp/config/astra-connect/secret', () => {
  beforeEach(() => {
    h.requireRole.mockReset().mockResolvedValue({
      supabase: h.supabase,
      accountId: 'acct-1',
    })
    h.supabase.from.mockReset()
    h.buildSecretRotationUpdate.mockClear()
  })

  it('generates a reveal-once secret when none exists', async () => {
    const load = chain({
      data: {
        astra_connect_secret_encrypted: null,
        astra_connect_secret_previous_encrypted: null,
        astra_connect_secret_previous_expires_at: null,
      },
      error: null,
    })
    const save = chain({
      data: {
        astra_connect_secret_encrypted: 'cipher',
        astra_connect_secret_previous_expires_at: null,
      },
      error: null,
    })
    h.supabase.from
      .mockReturnValueOnce(load)
      .mockReturnValueOnce(save)

    const res = await POST(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ action: 'generate' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(body.has_secret).toBe(true)
    expect(body.action).toBe('generate')
  })

  it('rejects generate when a secret already exists', async () => {
    h.supabase.from.mockReturnValue(
      chain({
        data: { astra_connect_secret_encrypted: 'existing' },
        error: null,
      }),
    )
    const res = await POST(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ action: 'generate' }),
      }),
    )
    expect(res.status).toBe(409)
  })

  it('rotates even when a secret exists', async () => {
    const load = chain({
      data: {
        astra_connect_secret_encrypted: 'old',
        astra_connect_secret_previous_encrypted: null,
        astra_connect_secret_previous_expires_at: null,
      },
      error: null,
    })
    const save = chain({
      data: {
        astra_connect_secret_encrypted: 'cipher',
        astra_connect_secret_previous_expires_at: new Date(
          Date.now() + 86400000,
        ).toISOString(),
      },
      error: null,
    })
    h.supabase.from.mockReturnValueOnce(load).mockReturnValueOnce(save)

    const res = await POST(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ action: 'rotate' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.secret).toBeTruthy()
    expect(body.action).toBe('rotate')
  })
})

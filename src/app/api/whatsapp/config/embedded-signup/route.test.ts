import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  encrypt: vi.fn((v: string) => `enc:${v}`),
  supabase: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => {
    const message = err instanceof Error ? err.message : 'error'
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status)
        : 401
    return new Response(JSON.stringify({ error: message }), { status })
  },
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: h.encrypt,
}))

import { GET, POST } from './route'

function chain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {}
  api.select = vi.fn(() => api)
  api.eq = vi.fn(() => api)
  api.update = vi.fn(() => api)
  api.insert = vi.fn(async () => result)
  api.maybeSingle = vi.fn(async () => result)
  // update().eq() resolves
  ;(api.eq as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const next = {
      ...api,
      then: undefined,
      eq: vi.fn(async () => result),
      maybeSingle: vi.fn(async () => result),
    }
    // allow awaiting update().eq()
    ;(next as { then?: unknown }).then = undefined
    return Object.assign(Promise.resolve(result), next)
  })
  return api
}

describe('GET /api/whatsapp/config/embedded-signup', () => {
  beforeEach(() => {
    h.requireRole.mockReset().mockResolvedValue({
      supabase: h.supabase,
      accountId: 'acct-1',
      userId: 'user-1',
    })
    delete process.env.WHATSAPP_EMBEDDED_SIGNUP
    delete process.env.META_STUB
    delete process.env.META_APP_ID
  })

  it('reports enabled=false when the flag is off', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      enabled: false,
      stub: false,
      app_id: null,
    })
  })

  it('reports enabled + stub when flags are on', async () => {
    process.env.WHATSAPP_EMBEDDED_SIGNUP = '1'
    process.env.META_STUB = '1'
    process.env.META_APP_ID = '12345'
    const res = await GET()
    await expect(res.json()).resolves.toEqual({
      enabled: true,
      stub: true,
      app_id: '12345',
    })
  })
})

describe('POST /api/whatsapp/config/embedded-signup', () => {
  beforeEach(() => {
    h.requireRole.mockReset().mockResolvedValue({
      supabase: h.supabase,
      accountId: 'acct-1',
      userId: 'user-1',
    })
    h.encrypt.mockClear().mockImplementation((v: string) => `enc:${v}`)
    h.supabase.from.mockReset()
    delete process.env.WHATSAPP_EMBEDDED_SIGNUP
    delete process.env.META_STUB
    delete process.env.META_APP_ID
    delete process.env.META_APP_SECRET
    delete process.env.ENCRYPTION_KEY
    // Valid 32-byte hex key for encrypt path when not stubbing encrypt... we mock encrypt.
    process.env.ENCRYPTION_KEY = '0'.repeat(64)
  })

  it('returns 404 when the feature flag is off', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/config/embedded-signup', {
        method: 'POST',
        body: JSON.stringify({ code: 'x' }),
      }),
    )
    expect(res.status).toBe(404)
  })

  it('META_STUB returns fake IDs and persists without calling Meta', async () => {
    process.env.WHATSAPP_EMBEDDED_SIGNUP = '1'
    process.env.META_STUB = '1'

    const selectApi = {
      select: vi.fn(() => selectApi),
      eq: vi.fn(() => selectApi),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      insert: vi.fn(async () => ({ data: null, error: null })),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: null, error: null })),
      })),
    }
    h.supabase.from.mockReturnValue(selectApi)

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const res = await POST(
      new Request('http://localhost/api/whatsapp/config/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'stub-code' }),
      }),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      stub: true,
      saved: true,
      waba_id: '900000000000001',
      phone_number_id: '900000000000002',
    })
    expect(body.access_token).toBeUndefined()
    expect(selectApi.insert).toHaveBeenCalled()
    expect(h.encrypt).toHaveBeenCalledWith('stub-embedded-signup-token')
  })
})

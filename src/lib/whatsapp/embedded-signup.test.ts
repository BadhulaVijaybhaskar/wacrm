import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  STUB_ACCESS_TOKEN,
  STUB_PHONE_NUMBER_ID,
  STUB_WABA_ID,
  exchangeEmbeddedSignupCode,
  isEmbeddedSignupEnabled,
  isMetaStubMode,
} from './embedded-signup'

describe('embedded signup flags', () => {
  afterEach(() => {
    delete process.env.WHATSAPP_EMBEDDED_SIGNUP
    delete process.env.META_STUB
  })

  it('isEmbeddedSignupEnabled reads truthy env values', () => {
    delete process.env.WHATSAPP_EMBEDDED_SIGNUP
    expect(isEmbeddedSignupEnabled()).toBe(false)
    process.env.WHATSAPP_EMBEDDED_SIGNUP = '1'
    expect(isEmbeddedSignupEnabled()).toBe(true)
    process.env.WHATSAPP_EMBEDDED_SIGNUP = 'true'
    expect(isEmbeddedSignupEnabled()).toBe(true)
    process.env.WHATSAPP_EMBEDDED_SIGNUP = '0'
    expect(isEmbeddedSignupEnabled()).toBe(false)
  })

  it('disables old scaffolding when the Phase 1 flag is enabled', () => {
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP', '1')
    process.env.WHATSAPP_EMBEDDED_SIGNUP = '1'
    expect(isEmbeddedSignupEnabled()).toBe(false)
    vi.unstubAllEnvs()
  })

  it('isMetaStubMode reads truthy env values', () => {
    delete process.env.META_STUB
    expect(isMetaStubMode()).toBe(false)
    process.env.META_STUB = '1'
    expect(isMetaStubMode()).toBe(true)
  })
})

describe('exchangeEmbeddedSignupCode', () => {
  afterEach(() => {
    delete process.env.META_STUB
    delete process.env.META_APP_ID
    delete process.env.META_APP_SECRET
  })

  it('returns fake numeric IDs in META_STUB mode without calling fetch', async () => {
    process.env.META_STUB = '1'
    const fetchFn = vi.fn()
    const result = await exchangeEmbeddedSignupCode({
      code: 'any-code',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(result).toEqual({
      waba_id: STUB_WABA_ID,
      phone_number_id: STUB_PHONE_NUMBER_ID,
      access_token: STUB_ACCESS_TOKEN,
      stub: true,
    })
    expect(/^\d+$/.test(result.waba_id)).toBe(true)
    expect(/^\d+$/.test(result.phone_number_id)).toBe(true)
  })

  it('rejects empty code', async () => {
    process.env.META_STUB = '1'
    await expect(
      exchangeEmbeddedSignupCode({ code: '  ' }),
    ).rejects.toMatchObject({ message: 'code is required', status: 400 })
  })

  it('live path exchanges code via injected fetchFn (never hits real Meta)', async () => {
    process.env.META_APP_ID = 'app-123'
    process.env.META_APP_SECRET = 'secret-abc'
    const calls: string[] = []
    const fetchFn = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ access_token: 'EAAB-live-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    const result = await exchangeEmbeddedSignupCode({
      code: 'oauth-code',
      wabaId: '111222333444555',
      phoneNumberId: '999888777666555',
      fetchFn,
    })
    expect(result.stub).toBe(false)
    expect(result.access_token).toBe('EAAB-live-token')
    expect(result.waba_id).toBe('111222333444555')
    expect(result.phone_number_id).toBe('999888777666555')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('graph.facebook.com')
    expect(calls[0]).toContain('client_id=app-123')
    expect(calls[0]).toContain('code=oauth-code')
  })

  it('live path requires session waba/phone ids', async () => {
    process.env.META_APP_ID = 'app-123'
    process.env.META_APP_SECRET = 'secret-abc'
    const fetchFn = vi.fn()
    await expect(
      exchangeEmbeddedSignupCode({
        code: 'oauth-code',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

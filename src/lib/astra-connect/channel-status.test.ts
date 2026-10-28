import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from './sign'
import {
  CHANNEL_STATUS_CACHE_TTL_MS,
  CONNECT_WHATSAPP_CHANNEL_STATUS_PATH,
  ChannelGateError,
  __peekChannelStatusCacheSizeForTests,
  __resetChannelStatusCacheForTests,
  assertWhatsAppChannelEnabled,
  assertWhatsAppChannelEnabledForAccount,
  fetchWhatsAppChannelStatus,
} from './channel-status'
import type { AstraConnectAccountConfig } from './types'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'
const BASE = 'https://connect.test'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function activeAccount(
  overrides: Partial<AstraConnectAccountConfig> = {},
): AstraConnectAccountConfig {
  return {
    enabled: true,
    tenantId: TENANT,
    phoneNumberId: PHONE,
    whatsappNumber: null,
    employeeId: 'emp_1',
    secrets: {
      currentEncrypted: null,
      previousEncrypted: null,
      previousExpiresAt: null,
    },
    ...overrides,
  }
}

describe('fetchWhatsAppChannelStatus', () => {
  const prevUrl = process.env.CONNECT_ADAPTER_URL
  const prevSecret = process.env.WACRM_ADAPTER_SECRET

  beforeEach(() => {
    __resetChannelStatusCacheForTests()
    process.env.CONNECT_ADAPTER_URL = BASE
    process.env.WACRM_ADAPTER_SECRET = SECRET
  })

  afterEach(() => {
    __resetChannelStatusCacheForTests()
    if (prevUrl === undefined) delete process.env.CONNECT_ADAPTER_URL
    else process.env.CONNECT_ADAPTER_URL = prevUrl
    if (prevSecret === undefined) delete process.env.WACRM_ADAPTER_SECRET
    else process.env.WACRM_ADAPTER_SECRET = prevSecret
  })

  it('GETs the config path with Astra HMAC over an empty body', async () => {
    let seenUrl = ''
    let seen: RequestInit | undefined
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      seenUrl = url
      seen = init
      return jsonResponse(200, { enabled: true, employee_id: 'emp_1' })
    })

    const ts = 1_793_100_000
    const result = await fetchWhatsAppChannelStatus({
      tenantId: TENANT,
      phoneNumberId: PHONE,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: fetchFn as unknown as typeof fetch,
      nowMs: () => ts * 1000,
      bypassCache: true,
    })

    expect(result).toEqual({ enabled: true, employee_id: 'emp_1' })
    expect(seenUrl).toBe(
      `${BASE}${CONNECT_WHATSAPP_CHANNEL_STATUS_PATH}?tenant_id=${TENANT}&phone_number_id=${PHONE}`,
    )
    expect(seen!.method).toBe('GET')
    const headers = seen!.headers as Record<string, string>
    expect(headers['X-Astra-Timestamp']).toBe(String(ts))
    expect(headers['X-Astra-Signature']).toBe(
      buildAstraSignature('', SECRET, ts),
    )
  })

  it('caches for 30s then refetches after expiry', async () => {
    let now = 1_000_000
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { enabled: true, employee_id: 'e1' }))
      .mockResolvedValueOnce(jsonResponse(200, { enabled: false, employee_id: 'e1' }))

    const opts = {
      tenantId: TENANT,
      phoneNumberId: PHONE,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: fetchFn as unknown as typeof fetch,
      nowMs: () => now,
    }

    await fetchWhatsAppChannelStatus(opts)
    await fetchWhatsAppChannelStatus(opts)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(__peekChannelStatusCacheSizeForTests()).toBe(1)

    now += CHANNEL_STATUS_CACHE_TTL_MS + 1
    const second = await fetchWhatsAppChannelStatus(opts)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(second.enabled).toBe(false)
  })

  it('throws channel_status_unavailable on Connect HTTP/network errors', async () => {
    await expect(
      fetchWhatsAppChannelStatus({
        tenantId: TENANT,
        phoneNumberId: PHONE,
        secret: SECRET,
        baseUrl: BASE,
        fetchFn: (async () => jsonResponse(503, { error: 'down' })) as typeof fetch,
        bypassCache: true,
      }),
    ).rejects.toMatchObject({
      name: 'ChannelGateError',
      code: 'channel_status_unavailable',
    })

    await expect(
      fetchWhatsAppChannelStatus({
        tenantId: TENANT,
        phoneNumberId: PHONE,
        secret: SECRET,
        baseUrl: BASE,
        fetchFn: (async () => {
          throw new Error('ECONNRESET')
        }) as typeof fetch,
        bypassCache: true,
      }),
    ).rejects.toBeInstanceOf(ChannelGateError)
  })
})

describe('assertWhatsAppChannelEnabled', () => {
  it('throws channel_disabled when enabled:false', async () => {
    await expect(
      assertWhatsAppChannelEnabled({
        tenantId: TENANT,
        phoneNumberId: PHONE,
        secret: SECRET,
        baseUrl: BASE,
        fetchFn: (async () =>
          jsonResponse(200, {
            enabled: false,
            employee_id: 'emp_off',
          })) as typeof fetch,
        bypassCache: true,
      }),
    ).rejects.toMatchObject({
      code: 'channel_disabled',
      employeeId: 'emp_off',
    })
  })

  it('returns status when enabled:true', async () => {
    const status = await assertWhatsAppChannelEnabled({
      tenantId: TENANT,
      phoneNumberId: PHONE,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: (async () =>
        jsonResponse(200, { enabled: true, employee_id: 'emp_on' })) as typeof fetch,
      bypassCache: true,
    })
    expect(status).toEqual({ enabled: true, employee_id: 'emp_on' })
  })
})

describe('assertWhatsAppChannelEnabledForAccount', () => {
  const prevUrl = process.env.CONNECT_ADAPTER_URL
  const prevSecret = process.env.WACRM_ADAPTER_SECRET

  beforeEach(() => {
    __resetChannelStatusCacheForTests()
    process.env.CONNECT_ADAPTER_URL = BASE
    process.env.WACRM_ADAPTER_SECRET = SECRET
  })

  afterEach(() => {
    __resetChannelStatusCacheForTests()
    if (prevUrl === undefined) delete process.env.CONNECT_ADAPTER_URL
    else process.env.CONNECT_ADAPTER_URL = prevUrl
    if (prevSecret === undefined) delete process.env.WACRM_ADAPTER_SECRET
    else process.env.WACRM_ADAPTER_SECRET = prevSecret
  })

  it('skips when Connect integration is off (standalone)', async () => {
    const fetchFn = vi.fn()
    const result = await assertWhatsAppChannelEnabledForAccount({
      accountId: 'acct-1',
      phoneNumberId: PHONE,
      db: { from: () => ({}) },
      fetchFn: fetchFn as unknown as typeof fetch,
      loadConfig: async () =>
        activeAccount({ enabled: false, tenantId: '', phoneNumberId: '' }),
    })
    expect(result).toEqual({ skipped: true })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('blocks when Connect says enabled:false', async () => {
    await expect(
      assertWhatsAppChannelEnabledForAccount({
        accountId: 'acct-1',
        phoneNumberId: PHONE,
        db: { from: () => ({}) },
        fetchFn: (async () =>
          jsonResponse(200, {
            enabled: false,
            employee_id: 'emp_x',
          })) as typeof fetch,
        bypassCache: true,
        loadConfig: async () => activeAccount(),
      }),
    ).rejects.toMatchObject({ code: 'channel_disabled' })
  })

  it('allows when Connect says enabled:true', async () => {
    const status = await assertWhatsAppChannelEnabledForAccount({
      accountId: 'acct-1',
      phoneNumberId: PHONE,
      db: { from: () => ({}) },
      fetchFn: (async () =>
        jsonResponse(200, { enabled: true, employee_id: 'emp_x' })) as typeof fetch,
      bypassCache: true,
      loadConfig: async () => activeAccount(),
    })
    expect(status).toMatchObject({ enabled: true })
  })

  it('fail-closes on Connect errors', async () => {
    await expect(
      assertWhatsAppChannelEnabledForAccount({
        accountId: 'acct-1',
        phoneNumberId: PHONE,
        db: { from: () => ({}) },
        fetchFn: (async () => jsonResponse(500, {})) as typeof fetch,
        bypassCache: true,
        loadConfig: async () => activeAccount(),
      }),
    ).rejects.toMatchObject({ code: 'channel_status_unavailable' })
  })
})

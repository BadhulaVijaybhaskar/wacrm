import { createHmac } from 'node:crypto'
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
  buildChannelStatusCanonical,
  buildChannelStatusQuery,
  fetchWhatsAppChannelStatus,
} from './channel-status'
import type { AstraConnectAccountConfig } from './types'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'
const BASE = 'https://connect.test'

/** Fixed §2a vector — do not recompute in the assertion; keep the hex literal. */
const FIXED_TS = 1_700_000_000
const FIXED_EXPECTED_HEX =
  '197485b97e06cb7589fc702642a877fd57ddb2c1e97b80c4ff41250fd486e3eb'

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
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

describe('§2a channel-status canonical HMAC', () => {
  it('matches a fixed expected hex for known secret/timestamp/params', () => {
    const canonical = buildChannelStatusCanonical(TENANT, PHONE)
    expect(canonical).toBe(
      'GET /api/channels/whatsapp/channel-status?tenant_id=tenant_abc&phone_number_id=106540352242922',
    )

    // Independent recomputation of the contract formula — must equal the
    // hard-coded hex (guards against accidental helper drift).
    const independent = createHmac('sha256', SECRET)
      .update(`${FIXED_TS}.`)
      .update(canonical)
      .digest('hex')
    expect(independent).toBe(FIXED_EXPECTED_HEX)

    expect(buildAstraSignature(canonical, SECRET, FIXED_TS)).toBe(
      `sha256=${FIXED_EXPECTED_HEX}`,
    )
  })

  it('encodeURIComponents params in tenant_id then phone_number_id order', () => {
    const tenant = 'ten/ant space'
    const phone = '1555/000'
    expect(buildChannelStatusCanonical(tenant, phone)).toBe(
      `GET ${CONNECT_WHATSAPP_CHANNEL_STATUS_PATH}?tenant_id=${encodeURIComponent(tenant)}&phone_number_id=${encodeURIComponent(phone)}`,
    )
    expect(buildChannelStatusQuery(tenant, phone)).toBe(
      `tenant_id=${encodeURIComponent(tenant)}&phone_number_id=${encodeURIComponent(phone)}`,
    )
  })
})

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

  it('GETs §2a path and signs the canonical string (not an empty body)', async () => {
    let seenUrl = ''
    let seen: RequestInit | undefined
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      seenUrl = url
      seen = init
      return jsonResponse(200, { enabled: true, employee_id: 'emp_1' })
    })

    const ts = FIXED_TS
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
    expect(CONNECT_WHATSAPP_CHANNEL_STATUS_PATH).toBe(
      '/api/channels/whatsapp/channel-status',
    )
    expect(seenUrl).toBe(
      `${BASE}${CONNECT_WHATSAPP_CHANNEL_STATUS_PATH}?${buildChannelStatusQuery(TENANT, PHONE)}`,
    )
    expect(seen!.method).toBe('GET')
    const headers = seen!.headers as Record<string, string>
    expect(headers['X-Astra-Timestamp']).toBe(String(ts))
    expect(headers['X-Astra-Signature']).toBe(
      `sha256=${FIXED_EXPECTED_HEX}`,
    )
    // Must NOT be the empty-body webhook signature.
    expect(headers['X-Astra-Signature']).not.toBe(
      buildAstraSignature('', SECRET, ts),
    )
  })

  it('caches only 200 responses for 30s then refetches after expiry', async () => {
    let now = 1_000_000
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { enabled: true, employee_id: 'e1' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { enabled: false, employee_id: 'e1' }),
      )

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

  it('does not cache 404/429 and does not retry (no hammering)', async () => {
    const fetch404 = vi.fn(async () => jsonResponse(404, { error: 'not_found' }))
    await expect(
      fetchWhatsAppChannelStatus({
        tenantId: TENANT,
        phoneNumberId: PHONE,
        secret: SECRET,
        baseUrl: BASE,
        fetchFn: fetch404 as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'channel_not_linked' })
    expect(__peekChannelStatusCacheSizeForTests()).toBe(0)

    // Second call hits the network again (uncached) — still a single
    // attempt per call, never a retry loop inside one request.
    await expect(
      fetchWhatsAppChannelStatus({
        tenantId: TENANT,
        phoneNumberId: PHONE,
        secret: SECRET,
        baseUrl: BASE,
        fetchFn: fetch404 as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'channel_not_linked' })
    expect(fetch404).toHaveBeenCalledTimes(2)

    const fetch429 = vi.fn(async () =>
      jsonResponse(429, { error: 'rate_limited' }, { 'Retry-After': '3' }),
    )
    await expect(
      fetchWhatsAppChannelStatus({
        tenantId: TENANT,
        phoneNumberId: 'other-phone',
        secret: SECRET,
        baseUrl: BASE,
        fetchFn: fetch429 as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      code: 'channel_status_unavailable',
      message: expect.stringContaining('429'),
    })
    expect(fetch429).toHaveBeenCalledTimes(1)
    expect(__peekChannelStatusCacheSizeForTests()).toBe(0)
  })

  it('throws channel_not_linked on Connect 404 (no employee owns the number)', async () => {
    await expect(
      fetchWhatsAppChannelStatus({
        tenantId: TENANT,
        phoneNumberId: PHONE,
        secret: SECRET,
        baseUrl: BASE,
        fetchFn: (async () =>
          jsonResponse(404, { error: 'not_found' })) as typeof fetch,
        bypassCache: true,
      }),
    ).rejects.toMatchObject({
      name: 'ChannelGateError',
      code: 'channel_not_linked',
    })
  })

  it('throws channel_status_unavailable on 401/503/timeout/network', async () => {
    for (const status of [401, 503]) {
      await expect(
        fetchWhatsAppChannelStatus({
          tenantId: TENANT,
          phoneNumberId: PHONE,
          secret: SECRET,
          baseUrl: BASE,
          fetchFn: (async () => jsonResponse(status, {})) as typeof fetch,
          bypassCache: true,
        }),
      ).rejects.toMatchObject({ code: 'channel_status_unavailable' })
    }

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
        jsonResponse(200, {
          enabled: true,
          employee_id: 'emp_on',
        })) as typeof fetch,
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
        jsonResponse(200, {
          enabled: true,
          employee_id: 'emp_x',
        })) as typeof fetch,
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

  it('blocks as channel_not_linked when Connect returns 404', async () => {
    await expect(
      assertWhatsAppChannelEnabledForAccount({
        accountId: 'acct-1',
        phoneNumberId: PHONE,
        db: { from: () => ({}) },
        fetchFn: (async () => jsonResponse(404, {})) as typeof fetch,
        bypassCache: true,
        loadConfig: async () => activeAccount(),
      }),
    ).rejects.toMatchObject({ code: 'channel_not_linked' })
  })
})

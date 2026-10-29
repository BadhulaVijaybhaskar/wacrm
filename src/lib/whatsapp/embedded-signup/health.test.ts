import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptToken } from './crypto'
import { checkAccountConnections, checkScheduledConnections } from './health'

const h = vi.hoisted(() => ({
  rows: [] as { id: string; account_id: string; phone_number_id: string; token_ciphertext: string; status: string }[],
  updates: [] as { id: string; patch: Record<string, unknown> }[],
  failUpdates: false,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: () => ({
    schema: () => ({
      from: () => ({
        select: () => {
          const filters: Record<string, unknown> = {}
          const query = {
            eq: (key: string, value: unknown) => {
              filters[key] = value
              return query
            },
            order: () => query,
            limit: async () => ({ data: h.rows, error: null }),
            then: (resolve: (value: unknown) => void) =>
              resolve({
                data: h.rows.filter((r) => r.account_id === filters.account_id),
                error: null,
              }),
          }
          return query
        },
        update: (patch: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {}
          const query = {
            eq: (key: string, value: unknown) => {
              filters[key] = value
              return query
            },
            then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
              if (h.failUpdates) return reject(new Error('db down'))
              h.updates.push({ id: String(filters.id), patch })
              resolve({ error: null })
            },
          }
          return query
        },
      }),
    }),
  }),
}))

const healthyDebug = {
  data: {
    is_valid: true,
    app_id: 'test-app',
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
  },
}

function row(id: string, account: string) {
  return {
    id,
    account_id: account,
    phone_number_id: 'phone-' + id,
    token_ciphertext: encryptToken('token-' + id),
    status: 'connected',
  }
}

beforeEach(() => {
  vi.stubEnv('META_APP_ID', 'test-app')
  vi.stubEnv('META_APP_SECRET', 'test-secret')
  vi.stubEnv('WACRM_TOKEN_ENC_KEY', Buffer.alloc(32, 1).toString('base64'))
  h.rows = [row('a1', 'A'), row('b1', 'B')]
  h.updates = []
  h.failUpdates = false
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('WhatsApp connection health check', () => {
  it('does not stop the batch when account A fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const input = new URL(String(url)).searchParams.get('input_token')
      if (input === 'token-a1') throw new TypeError('network down')
      return Response.json(healthyDebug)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(checkScheduledConnections()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(h.updates.filter((u) => 'last_error' in u.patch).map((u) => u.id)).toEqual(['b1'])
  })

  it('bumps updated_at on a healthy check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(healthyDebug)))
    await checkAccountConnections('A')
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].patch.last_error).toBeNull()
    expect(typeof h.updates[0].patch.updated_at).toBe('string')
  })

  it('leaves the status connected on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(checkAccountConnections('A')).rejects.toBeTruthy()
    await checkScheduledConnections()
    expect(h.updates.some((u) => u.patch.status === 'error')).toBe(false)
    expect(h.updates.every((u) => Object.keys(u.patch).join() === 'updated_at')).toBe(true)
  })

  it('bumps only updated_at for a failing account so it leaves the front of the scan', async () => {
    h.rows = [row('a1', 'A'), row('b1', 'B')]
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await checkScheduledConnections()
    expect(h.updates).toHaveLength(2)
    for (const u of h.updates) expect(Object.keys(u.patch)).toEqual(['updated_at'])
  })

  it('swallows a failure of the updated_at bump', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    h.failUpdates = true
    await expect(checkScheduledConnections()).resolves.toBeUndefined()
  })

  it('stops scanning remaining accounts once aborted', async () => {
    const fetchMock = vi.fn(async () => Response.json(healthyDebug))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await checkScheduledConnections({ signal: controller.signal })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptToken } from './crypto'
import { checkAccountConnections, checkScheduledConnections } from './health'

const h = vi.hoisted(() => ({
  rows: [] as { id: string; account_id: string; phone_number_id: string; token_ciphertext: string; status: string }[],
  updates: [] as { id: string; patch: Record<string, unknown>; filters:Record<string,unknown> }[],
  failUpdates: false, returnedError:false, missingColumn:false, missingStamp:false,
  orders:[] as {key:string;options:unknown}[],
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
            order: (key:string,options:unknown) => {h.orders.push({key,options});return query;},
            limit: async () => ({ data: h.rows, error: h.missingColumn&&h.orders.at(-1)?.key==='last_health_check_at'?{code:'42703'}:null }),
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
              h.updates.push({ id: String(filters.id), patch, filters })
              resolve({ error: h.missingStamp&&'last_health_check_at' in patch?{code:'PGRST204'}:h.returnedError?{code:'test-error'}:null })
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
  h.returnedError=false;h.missingColumn=false;h.missingStamp=false;h.orders=[]
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

  it('stamps last_health_check_at on a healthy check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(healthyDebug)))
    await checkAccountConnections('A')
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].patch.last_error).toBeNull()
    expect(typeof h.updates[0].patch.last_health_check_at).toBe('string')
  })

  it('leaves the status connected on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(checkAccountConnections('A')).rejects.toBeTruthy()
    await checkScheduledConnections()
    expect(h.updates.some((u) => u.patch.status === 'error')).toBe(false)
    expect(h.updates.every((u) => Object.keys(u.patch).join() === 'last_health_check_at')).toBe(true)
  })

  it('stamps only last_health_check_at for a failing account so it leaves the front of the scan', async () => {
    h.rows = [row('a1', 'A'), row('b1', 'B')]
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await checkScheduledConnections()
    expect(h.updates).toHaveLength(2)
    for (const [i,u] of h.updates.entries()){
      expect(Object.keys(u.patch)).toEqual(['last_health_check_at']);
      expect(u.filters).toEqual({account_id:i===0?'A':'B',status:'connected'});
    }
  })

  it('logs and swallows a rejected deferral write', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    h.failUpdates = true
    await expect(checkScheduledConnections()).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith('[embedded-signup] health check deferral failed')
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

it('orders by oldest health check, nulls first',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(healthyDebug)));
 await checkScheduledConnections();
 expect(h.orders).toEqual([{key:'last_health_check_at',options:{ascending:true,nullsFirst:true}}]);
});
it('falls back on missing scan column and skips health stamps',async()=>{
 h.missingColumn=true;vi.stubGlobal('fetch',vi.fn(async()=>Response.json(healthyDebug)));
 await expect(checkScheduledConnections()).resolves.toBeUndefined();
 expect(h.orders.map(o=>o.key)).toEqual(['last_health_check_at','updated_at']);
 expect(h.updates.every(u=>'updated_at' in u.patch && !('last_health_check_at' in u.patch))).toBe(true);
 await checkScheduledConnections();
 expect(vi.mocked(console.warn).mock.calls.filter(([message])=>String(message).includes('last_health_check_at unavailable'))).toHaveLength(1);
});
it('falls back when the stamp reports a missing column',async()=>{
 h.missingStamp=true;vi.stubGlobal('fetch',vi.fn(async()=>Response.json(healthyDebug)));
 await expect(checkAccountConnections('A')).resolves.toBeTruthy();
 expect(h.updates[1].patch).toHaveProperty('updated_at');
});
it('logs returned deferral errors without throwing or stopping the batch',async()=>{
 h.returnedError=true;vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('network');}));
 await expect(checkScheduledConnections()).resolves.toBeUndefined();
 expect(console.warn).toHaveBeenCalledWith('[embedded-signup] health check deferral failed');
 expect(h.updates.map(u=>u.filters)).toEqual([{account_id:'A',status:'connected'},{account_id:'B',status:'connected'}]);
});

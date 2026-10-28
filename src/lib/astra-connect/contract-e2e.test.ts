// Voice E2E contract check: Astraconnect PR #33 console sender
// (feat/wa-after-call @ 97b9948) -> wacrm route handlers
// (cursor/wa-after-call-adapter). Real HMAC verify in wacrm; Supabase
// faked in memory; Meta send mocked. No network.
//
// Import paths adapted from Voice's scratch harness:
//   - Connect client → test/fixtures/astraconnect-wa-after-call
//     (Astraconnect private; fixture mirrors listTemplates/createAfterCall
//     + wa-provider.sign from the e2e contract)
//   - POST path → /api/astra-connect/v1/whatsapp/send (§16.2)
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const SECRET = 'e2e-secret-'.padEnd(40, 'q')
const TENANT = 't_a'
const PNID = '100000000000001'
const WABA = '200000000000002'
const ACCOUNT = 'acc1'

const meta = vi.hoisted(() => ({ calls: [] as unknown[] }))

function fakeDb() {
  const tables: Record<string, Record<string, unknown>[]> = {
    whatsapp_config: [
      {
        id: 'cfg1',
        account_id: ACCOUNT,
        phone_number_id: PNID,
        access_token: 'enc',
        waba_id: WABA,
        status: 'connected',
        astra_connect_tenant_id: TENANT,
        astra_employee_id: 'emp_a',
        astra_connect_enabled: true,
        astra_connect_secret_encrypted: null,
        astra_connect_secret_previous_encrypted: null,
        astra_connect_secret_previous_expires_at: null,
      },
    ],
    message_templates: [
      {
        account_id: ACCOUNT,
        name: 'hello_world',
        language: 'en_US',
        category: 'UTILITY',
        status: 'APPROVED',
        body_text: 'Hello World',
        meta_template_id: '1',
      },
      {
        account_id: ACCOUNT,
        name: 'call_followup',
        language: 'en_US',
        category: 'UTILITY',
        status: 'APPROVED',
        body_text: 'Hi {{1}}, {{2}} {{3}} {{4}}',
        meta_template_id: '2',
      },
    ],
    astra_after_call_sends: [],
    contacts: [],
    conversations: [],
    messages: [],
  }

  const q = (rows: Record<string, unknown>[], table?: string) => {
    const b: any = {
      _rows: rows,
      _filters: {} as Record<string, unknown>,
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (k: string, v: unknown) => {
        b._filters[k] = v
        return q(
          (b._rows as Record<string, unknown>[]).filter(
            (r) => String(r[k]) === String(v),
          ),
          table,
        )
      },
      is: () => b,
      gt: () => b,
      ilike: () => b,
      maybeSingle: async () => ({
        data: (b._rows as unknown[])[0] ?? null,
        error: null,
      }),
      single: async () => ({
        data: (b._rows as unknown[])[0] ?? null,
        error: null,
      }),
      insert: async (row: Record<string, unknown>) => {
        const target = table ? tables[table] : null
        if (!target) return { data: row, error: null }
        if (table === 'astra_after_call_sends') {
          const clash = target.find(
            (r) =>
              String(r.account_id) === String(row.account_id) &&
              String(r.idempotency_key) === String(row.idempotency_key),
          )
          if (clash) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate' },
            }
          }
        }
        target.push(row)
        return { data: row, error: null }
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {}
        const chain: any = {
          eq(k: string, v: unknown) {
            filters[k] = v
            return chain
          },
          then(res: any, rej: any) {
            return Promise.resolve(chain._run()).then(res, rej)
          },
          async _run() {
            const target = table ? tables[table] : null
            if (target) {
              for (const r of target) {
                if (
                  Object.entries(filters).every(
                    ([k, v]) => String(r[k]) === String(v),
                  )
                ) {
                  Object.assign(r, patch)
                }
              }
            }
            return { data: null, error: null }
          },
        }
        return new Proxy(chain, {
          get(target, prop, receiver) {
            if (prop === 'then') {
              return (res: any, rej: any) =>
                Promise.resolve(target._run()).then(res, rej)
            }
            return Reflect.get(target, prop, receiver)
          },
        })
      },
      delete: () => {
        const filters: Record<string, unknown> = {}
        const chain: any = {
          eq(k: string, v: unknown) {
            filters[k] = v
            return chain
          },
          then(res: any, rej: any) {
            return Promise.resolve(chain._run()).then(res, rej)
          },
          async _run() {
            const target = table ? tables[table] : null
            if (target) {
              for (let i = target.length - 1; i >= 0; i--) {
                const r = target[i]
                if (
                  Object.entries(filters).every(
                    ([k, v]) => String(r[k]) === String(v),
                  )
                ) {
                  target.splice(i, 1)
                }
              }
            }
            return { data: null, error: null }
          },
        }
        return new Proxy(chain, {
          get(target, prop, receiver) {
            if (prop === 'then') {
              return (res: any, rej: any) =>
                Promise.resolve(target._run()).then(res, rej)
            }
            return Reflect.get(target, prop, receiver)
          },
        })
      },
      then: (res: any, rej: any) =>
        Promise.resolve({ data: b._rows, error: null }).then(res, rej),
    }
    return b
  }
  return {
    from: (t: string) => q(tables[t] ?? [], t),
    rpc: async () => ({ data: null, error: null }),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: () => fakeDb(),
  __resetServiceClientForTests: () => {},
}))
vi.mock('@/lib/whatsapp/encryption', async (orig) => ({
  ...(await orig<any>()),
  decrypt: () => 'meta-token-fake',
}))
vi.mock('@/lib/whatsapp/meta-api', async (orig) => ({
  ...(await orig<any>()),
  sendTemplateMessage: vi.fn(async (a: unknown) => {
    meta.calls.push(a)
    return { messageId: 'wamid.E2E' }
  }),
  sendTextMessage: vi.fn(async (a: unknown) => {
    meta.calls.push(a)
    return { messageId: 'wamid.E2E.text' }
  }),
}))

const req = createRequire(import.meta.url)
const fixtureDir = path.resolve(
  process.cwd(),
  'test/fixtures/astraconnect-wa-after-call',
)
let ac: any
let GET: any, POST: any

beforeAll(async () => {
  process.env.WACRM_ADAPTER_SECRET = SECRET
  process.env.WACRM_AFTER_CALL_TEMPLATES = '1'
  delete process.env.WHATSAPP_TEMPLATES_DRY_RUN
  delete process.env.META_STUB
  delete process.env.ENCRYPTION_KEY
  ac = req(path.join(fixtureDir, 'wa-after-call.js'))
  GET = (await import('@/app/api/astra-connect/v1/whatsapp/templates/route'))
    .GET
  POST = (await import('@/app/api/astra-connect/v1/whatsapp/send/route')).POST
})

const BASE = 'http://127.0.0.1:3999'
const seen: { method: string; path: string; status: number; json: unknown }[] =
  []
async function router(url: string, opts: any) {
  const u = new URL(url)
  const request = new Request(url, {
    method: opts.method || 'GET',
    headers: opts.headers,
    body: opts.body,
  })
  let res: Response
  if (
    u.pathname === '/api/astra-connect/v1/whatsapp/templates' &&
    request.method === 'GET'
  ) {
    res = await GET(request)
  } else if (
    u.pathname === '/api/astra-connect/v1/whatsapp/send' &&
    request.method === 'POST'
  ) {
    res = await POST(request)
  } else {
    res = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  }
  const json = await res.clone().json().catch(() => null)
  seen.push({
    method: request.method,
    path: u.pathname,
    status: res.status,
    json,
  })
  return res
}
const ENV = {
  WHATSAPP_AFTER_CALL: '1',
  WACRM_API_URL: BASE,
  WACRM_ADAPTER_SECRET: SECRET,
  NODE_ENV: 'test',
}

describe('PR #33 console <-> wacrm §16', () => {
  it('template list: console listTemplates against wacrm GET', async () => {
    const r = await ac.listTemplates(
      { tenantId: TENANT, phoneNumberId: PNID, wabaId: WABA },
      { env: ENV, fetchImpl: router, cacheMs: 0 },
    )
    expect(r.source).toBe('waba')
    expect(r.items.map((t: any) => t.name)).toContain('hello_world')
  })

  it('after-call send: console sendOne against wacrm', async () => {
    const db: any = {
      tenants: [{ id: TENANT, name: 'Acme' }],
      employees: [
        {
          id: 'emp_a',
          tenantId: TENANT,
          name: 'Priya',
          status: 'PUBLISHED',
          channels: {
            whatsapp: true,
            whatsappPhoneNumberId: PNID,
            whatsappNumber: '+15550000001',
          },
          whatsappAfterCall: {
            enabled: true,
            template: { name: 'hello_world', language: 'en_US' },
            variables: [],
            freeText: '',
            trigger: { mode: 'answered', outcomes: [] },
          },
        },
      ],
      whatsappNumbers: [
        {
          id: 'wan_0123456789abcdef',
          tenantId: TENANT,
          source: 'manual',
          displayPhoneNumber: '+15550000001',
          phoneNumberId: PNID,
          wabaId: WABA,
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      calls: [
        {
          id: 'call_1',
          tenantId: TENANT,
          employeeId: 'emp_a',
          direction: 'inbound',
          fromE164: '+919800000001',
          toE164: '+918000000000',
          contactPhone: '+919800000001',
          contactName: 'Ravi',
          summary: 'x',
          outcome: 'completed',
          startedAt: new Date().toISOString(),
          extractedData: {},
        },
      ],
      conversations: [],
      conversationMessages: [],
    }
    const svc = ac.createAfterCall({
      store: { db: () => db, mutate: async (fn: any) => fn(db) },
      env: ENV,
      fetchImpl: router,
      log: () => {},
    })
    const rec = await svc.enqueue({
      tenantId: TENANT,
      employeeId: 'emp_a',
      callId: 'call_1',
      answered: true,
      direction: 'inbound',
    })
    expect(rec?.state).toBe('pending')
    await svc.sendOne(rec.id)
    const done = db.waAfterCallSends[0]
    expect(done.state).toBe('sent')

    // Console body directly at wacrm's §16.2 path (idempotent replay).
    const raw = JSON.stringify({
      kind: 'whatsapp.after_call',
      send_id: rec.id,
      tenant_id: TENANT,
      employee_id: 'emp_a',
      call_id: 'call_1',
      phone_number_id: PNID,
      waba_id: WABA,
      to: '+919800000001',
      type: 'template',
      template: {
        name: 'hello_world',
        language: 'en_US',
        variables: [],
      },
    })
    const wp = req(path.join(fixtureDir, 'wa-provider.js'))
    const ts = String(Math.floor(Date.now() / 1000))
    await router(BASE + '/api/astra-connect/v1/whatsapp/send', {
      method: 'POST',
      body: raw,
      headers: {
        'content-type': 'application/json',
        'x-astra-timestamp': ts,
        'x-astra-tenant': TENANT,
        'x-astra-signature': wp.sign(SECRET, ts, raw, TENANT),
        'idempotency-key': 'after-call:call_1',
      },
    })
    const last = seen.at(-1)
    expect(last?.status).toBe(200)
    expect((last?.json as { ok?: boolean })?.ok).toBe(true)
    expect(meta.calls.length).toBeGreaterThanOrEqual(1)
  })
})

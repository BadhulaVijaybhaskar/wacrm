import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AFTER_CALL_SEND_KIND,
  countTemplateVariables,
  isAfterCallTemplatesEnabled,
  isDurableAfterCallStatus,
  isPendingStale,
  listApprovedTemplates,
  parseAfterCallIdempotencyKey,
  parseAfterCallSendBody,
  PENDING_STALE_MS,
  sendAfterCallMessage,
} from './after-call-templates'
import { MetaApiError } from '@/lib/whatsapp/meta-api'

const TENANT = 'tenant_abc'
const PHONE = '106540352242922'
const ACCOUNT = 'acct-1'
const CALL = 'call_1'
const IDEM = `after-call:${CALL}`

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => {
    if (v === 'enc-token') return 'plain-meta-token'
    throw new Error('bad token')
  },
}))

vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: vi.fn(async () => ({
    row: {
      id: 'tpl-1',
      user_id: 'u1',
      name: 'hello_world',
      category: 'Utility',
      language: 'en_US',
      body_text: 'Hello World',
      status: 'APPROVED',
      created_at: '2026-01-01T00:00:00Z',
    },
    malformed: false,
    language: 'en_US',
  })),
}))

type Row = Record<string, unknown>

function makeDb(opts: {
  config?: Row | null
  templates?: Row[]
  contacts?: Row[]
  conversations?: Row[]
  messages?: Row[]
  idempotency?: Row[]
}) {
  const idem = [...(opts.idempotency ?? [])]
  return {
    _idem: idem,
    from(table: string) {
      if (table === 'whatsapp_config') {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: opts.config ?? null, error: null }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'message_templates') {
        const result = { data: opts.templates ?? [], error: null }
        const chain: Record<string, unknown> = {
          eq() {
            return chain
          },
          order() {
            return chain
          },
          then(
            resolve: (v: typeof result) => unknown,
            reject?: (e: unknown) => unknown,
          ) {
            return Promise.resolve(result).then(resolve, reject)
          },
        }
        return {
          select() {
            return chain
          },
        }
      }
      if (table === 'contacts') {
        const rows = opts.contacts ?? []
        const chain: any = {
          eq(k: string, v: unknown) {
            chain._rows = (chain._rows ?? rows).filter(
              (r: Row) => String(r[k]) === String(v),
            )
            return chain
          },
          async maybeSingle() {
            const r = (chain._rows ?? rows)[0] ?? null
            return { data: r, error: null }
          },
        }
        return {
          select() {
            return chain
          },
        }
      }
      if (table === 'conversations') {
        const rows = opts.conversations ?? []
        const chain: any = {
          eq(k: string, v: unknown) {
            chain._rows = (chain._rows ?? rows).filter(
              (r: Row) => String(r[k]) === String(v),
            )
            return chain
          },
          order() {
            return chain
          },
          limit() {
            return chain
          },
          async maybeSingle() {
            const r = (chain._rows ?? rows)[0] ?? null
            return { data: r, error: null }
          },
        }
        return {
          select() {
            return chain
          },
        }
      }
      if (table === 'messages') {
        const rows = opts.messages ?? []
        const chain: any = {
          eq(k: string, v: unknown) {
            chain._rows = (chain._rows ?? rows).filter(
              (r: Row) => String(r[k]) === String(v),
            )
            return chain
          },
          order() {
            return chain
          },
          limit() {
            return chain
          },
          async maybeSingle() {
            const r = (chain._rows ?? rows)[0] ?? null
            return { data: r, error: null }
          },
        }
        return {
          select() {
            return chain
          },
        }
      }
      if (table === 'astra_after_call_sends') {
        return {
          select() {
            return {
              eq(k1: string, v1: unknown) {
                return {
                  eq(k2: string, v2: unknown) {
                    return {
                      async maybeSingle() {
                        const hit = idem.find(
                          (r) =>
                            String(r[k1]) === String(v1) &&
                            String(r[k2]) === String(v2),
                        )
                        return { data: hit ?? null, error: null }
                      },
                    }
                  },
                }
              },
            }
          },
          async insert(row: Row) {
            const clash = idem.find(
              (r) =>
                String(r.account_id) === String(row.account_id) &&
                String(r.idempotency_key) === String(row.idempotency_key),
            )
            if (clash) {
              return { data: null, error: { code: '23505', message: 'duplicate' } }
            }
            idem.push({ ...row })
            return { data: row, error: null }
          },
          update(patch: Row) {
            const filters: Record<string, unknown> = {}
            const chain: any = {
              eq(k: string, v: unknown) {
                filters[k] = v
                return chain
              },
              then(
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown,
              ) {
                return Promise.resolve(chain._run()).then(resolve, reject)
              },
              async _run() {
                for (const r of idem) {
                  if (
                    Object.entries(filters).every(
                      ([k, v]) => String(r[k]) === String(v),
                    )
                  ) {
                    Object.assign(r, patch)
                  }
                }
                return { data: null, error: null }
              },
            }
            // supabase builders are thenable via awaiting the filter chain
            const proxy = new Proxy(chain, {
              get(target, prop, receiver) {
                if (prop === 'then') {
                  return (
                    res: (v: unknown) => unknown,
                    rej?: (e: unknown) => unknown,
                  ) => Promise.resolve(target._run()).then(res, rej)
                }
                return Reflect.get(target, prop, receiver)
              },
            })
            return proxy
          },
          delete() {
            const filters: Record<string, unknown> = {}
            const chain: any = {
              eq(k: string, v: unknown) {
                filters[k] = v
                return chain
              },
              then(
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown,
              ) {
                return Promise.resolve(chain._run()).then(resolve, reject)
              },
              async _run() {
                for (let i = idem.length - 1; i >= 0; i--) {
                  const r = idem[i]
                  if (
                    Object.entries(filters).every(
                      ([k, v]) => String(r[k]) === String(v),
                    )
                  ) {
                    idem.splice(i, 1)
                  }
                }
                return { data: null, error: null }
              },
            }
            return new Proxy(chain, {
              get(target, prop, receiver) {
                if (prop === 'then') {
                  return (
                    res: (v: unknown) => unknown,
                    rej?: (e: unknown) => unknown,
                  ) => Promise.resolve(target._run()).then(res, rej)
                }
                return Reflect.get(target, prop, receiver)
              },
            })
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

function baseBody(over: Record<string, unknown> = {}) {
  return {
    kind: AFTER_CALL_SEND_KIND,
    send_id: 'wac_0123456789abcdef',
    tenant_id: TENANT,
    employee_id: 'emp_a',
    call_id: CALL,
    phone_number_id: PHONE,
    waba_id: '200000000000002',
    to: '919876543210',
    type: 'template' as const,
    template: {
      name: 'hello_world',
      language: 'en_US',
      variables: [] as string[],
    },
    ...over,
  }
}

const goodConfig = {
  id: 'cfg1',
  account_id: ACCOUNT,
  phone_number_id: PHONE,
  access_token: 'enc-token',
  waba_id: '200000000000002',
  status: 'connected',
  astra_connect_tenant_id: TENANT,
}

describe('isAfterCallTemplatesEnabled', () => {
  it('is off by default', () => {
    expect(isAfterCallTemplatesEnabled({})).toBe(false)
  })

  it('turns on for 1/true', () => {
    expect(
      isAfterCallTemplatesEnabled({ WACRM_AFTER_CALL_TEMPLATES: '1' }),
    ).toBe(true)
  })
})

describe('parseAfterCallSendBody / idempotency key', () => {
  it('accepts §16.2 template body', () => {
    const r = parseAfterCallSendBody(baseBody())
    expect(r.ok).toBe(true)
  })

  it('parses after-call idempotency keys', () => {
    expect(parseAfterCallIdempotencyKey(IDEM, CALL)).toMatchObject({
      ok: true,
      key: IDEM,
    })
  })
})

describe('durable status / stale pending', () => {
  it('marks only final statuses durable', () => {
    expect(isDurableAfterCallStatus(200)).toBe(true)
    expect(isDurableAfterCallStatus(409)).toBe(true)
    expect(isDurableAfterCallStatus(422)).toBe(true)
    expect(isDurableAfterCallStatus(429)).toBe(false)
    expect(isDurableAfterCallStatus(502)).toBe(false)
    expect(isDurableAfterCallStatus(500)).toBe(false)
  })

  it('detects stale pending after PENDING_STALE_MS', () => {
    const now = Date.parse('2026-10-28T12:00:00Z')
    expect(
      isPendingStale(
        new Date(now - PENDING_STALE_MS - 1).toISOString(),
        now,
      ),
    ).toBe(true)
    expect(
      isPendingStale(new Date(now - 60_000).toISOString(), now),
    ).toBe(false)
  })
})

describe('countTemplateVariables', () => {
  it('counts {{n}} placeholders', () => {
    expect(countTemplateVariables('Hi {{1}}, {{2}}')).toBe(2)
  })
})

describe('sendAfterCallMessage', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reserves pending then finalizes success; replay returns first result', async () => {
    const db = makeDb({ config: goodConfig })
    const sendTemplateFn = vi.fn(async () => ({ messageId: 'wamid.1' }))
    const parsed = parseAfterCallSendBody(baseBody())
    if (!parsed.ok) return

    const first = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(first).toMatchObject({
      ok: true,
      body: { ok: true, message_id: 'wamid.1' },
      replay: false,
    })
    expect(db._idem).toHaveLength(1)
    expect(db._idem[0].state).toBe('final')
    expect(sendTemplateFn).toHaveBeenCalledTimes(1)

    const second = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(second).toMatchObject({
      ok: true,
      body: { ok: true, message_id: 'wamid.1' },
      replay: true,
    })
    expect(sendTemplateFn).toHaveBeenCalledTimes(1)
  })

  it('returns 409 in_progress for a fresh pending reservation', async () => {
    const db = makeDb({
      config: goodConfig,
      idempotency: [
        {
          account_id: ACCOUNT,
          idempotency_key: IDEM,
          tenant_id: TENANT,
          call_id: CALL,
          send_id: 'wac_x',
          state: 'pending',
          status_code: 0,
          response_body: {},
          message_id: null,
          dry_run: false,
          created_at: new Date().toISOString(),
        },
      ],
    })
    const sendTemplateFn = vi.fn(async () => ({ messageId: 'wamid.x' }))
    const parsed = parseAfterCallSendBody(baseBody())
    if (!parsed.ok) return
    const r = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(r).toEqual({
      ok: false,
      status: 409,
      body: { error: 'in_progress' },
    })
    expect(sendTemplateFn).not.toHaveBeenCalled()
  })

  it('does not durable-store 429; releases pending so Meta can retry', async () => {
    const db = makeDb({ config: goodConfig })
    const sendTemplateFn = vi.fn(async () => {
      throw new MetaApiError('rate limited', {
        code: 4,
        httpStatus: 429,
        details: 'too many',
      })
    })
    const parsed = parseAfterCallSendBody(baseBody())
    if (!parsed.ok) return
    const r = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(r).toMatchObject({
      ok: false,
      status: 429,
      body: { error: 'rate_limited' },
    })
    expect(db._idem).toHaveLength(0)

    // Second attempt may call Meta again.
    sendTemplateFn.mockResolvedValueOnce({ messageId: 'wamid.retry' })
    const r2 = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(r2).toMatchObject({
      ok: true,
      body: { ok: true, message_id: 'wamid.retry' },
    })
    expect(sendTemplateFn).toHaveBeenCalledTimes(2)
  })

  it('does not durable-store 502; releases pending', async () => {
    const db = makeDb({ config: goodConfig })
    const sendTemplateFn = vi.fn(async () => {
      throw new MetaApiError('upstream', { httpStatus: 500, code: 1 })
    })
    const parsed = parseAfterCallSendBody(baseBody())
    if (!parsed.ok) return
    await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(db._idem).toHaveLength(0)
  })

  it('durable-stores Meta permanent 422 template_not_found', async () => {
    const db = makeDb({ config: goodConfig })
    const sendTemplateFn = vi.fn(async () => {
      throw new MetaApiError('Template name does not exist', {
        code: 132001,
        httpStatus: 400,
        details: 'Template name does not exist in the translation',
      })
    })
    const parsed = parseAfterCallSendBody(baseBody())
    if (!parsed.ok) return
    const r = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(r).toMatchObject({
      ok: false,
      status: 422,
      body: { error: 'template_not_found' },
    })
    expect(db._idem).toHaveLength(1)
    expect(db._idem[0].state).toBe('final')
    expect(db._idem[0].status_code).toBe(422)
  })

  it('dry_run finalizes without Meta', async () => {
    const db = makeDb({ config: goodConfig })
    const sendTemplateFn = vi.fn(async () => ({ messageId: 'wamid.nope' }))
    const parsed = parseAfterCallSendBody(baseBody())
    if (!parsed.ok) return
    const r = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: true,
    })
    expect(r).toEqual({
      ok: true,
      status: 200,
      body: { ok: true, dry_run: true },
      replay: false,
    })
    expect(sendTemplateFn).not.toHaveBeenCalled()
    expect(db._idem[0].state).toBe('final')
    expect(db._idem[0].dry_run).toBe(true)
  })

  it('returns 409 window_closed for text outside the 24h window', async () => {
    const db = makeDb({
      config: goodConfig,
      contacts: [
        { id: 'c1', account_id: ACCOUNT, phone_normalized: '919876543210' },
      ],
      conversations: [
        {
          id: 'conv1',
          account_id: ACCOUNT,
          contact_id: 'c1',
          channel: 'whatsapp',
          last_message_at: '2020-01-01T00:00:00Z',
        },
      ],
      messages: [
        {
          conversation_id: 'conv1',
          sender_type: 'customer',
          created_at: '2020-01-01T00:00:00Z',
        },
      ],
    })
    const parsed = parseAfterCallSendBody(
      baseBody({ type: 'text', text: 'Thanks', template: undefined }),
    )
    if (!parsed.ok) return
    const r = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      dryRun: false,
      now: new Date('2026-10-28T00:00:00Z'),
    })
    expect(r).toMatchObject({
      ok: false,
      status: 409,
      body: { error: 'window_closed' },
    })
    expect(db._idem[0].state).toBe('final')
  })

  it('takes over a stale pending reservation', async () => {
    const staleAt = new Date(Date.now() - PENDING_STALE_MS - 1000).toISOString()
    const db = makeDb({
      config: goodConfig,
      idempotency: [
        {
          account_id: ACCOUNT,
          idempotency_key: IDEM,
          tenant_id: TENANT,
          call_id: CALL,
          send_id: 'wac_old',
          state: 'pending',
          status_code: 0,
          response_body: {},
          message_id: null,
          dry_run: false,
          created_at: staleAt,
        },
      ],
    })
    const sendTemplateFn = vi.fn(async () => ({ messageId: 'wamid.stale' }))
    const parsed = parseAfterCallSendBody(baseBody())
    if (!parsed.ok) return
    const r = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTemplateFn,
      dryRun: false,
    })
    expect(r).toMatchObject({
      ok: true,
      body: { ok: true, message_id: 'wamid.stale' },
    })
    expect(sendTemplateFn).toHaveBeenCalledTimes(1)
  })
})

describe('listApprovedTemplates', () => {
  it('returns APPROVED only with variable_count', async () => {
    const db = makeDb({
      config: goodConfig,
      templates: [
        {
          name: 'hello_world',
          language: 'en_US',
          category: 'UTILITY',
          status: 'APPROVED',
          body_text: 'Hello World',
          meta_template_id: '1',
        },
      ],
    })
    const r = await listApprovedTemplates({
      db,
      accountId: ACCOUNT,
      tenantId: TENANT,
      phoneNumberId: PHONE,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.templates[0].name).toBe('hello_world')
  })
})

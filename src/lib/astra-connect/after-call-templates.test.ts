import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AFTER_CALL_SEND_KIND,
  countTemplateVariables,
  isAfterCallTemplatesEnabled,
  listApprovedTemplates,
  parseAfterCallIdempotencyKey,
  parseAfterCallSendBody,
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
            idem.push(row)
            return { data: row, error: null }
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
    expect(
      isAfterCallTemplatesEnabled({ WACRM_AFTER_CALL_TEMPLATES: '0' }),
    ).toBe(false)
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
    if (!r.ok) return
    expect(r.body.type).toBe('template')
    expect(r.body.template?.name).toBe('hello_world')
  })

  it('accepts text body', () => {
    const r = parseAfterCallSendBody(
      baseBody({ type: 'text', text: 'hi', template: undefined }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.body.type).toBe('text')
    expect(r.body.text).toBe('hi')
  })

  it('rejects legacy kind', () => {
    const r = parseAfterCallSendBody(
      baseBody({ kind: 'whatsapp.template_send' }),
    )
    expect(r).toEqual({ ok: false, error: 'bad_kind' })
  })

  it('parses after-call idempotency keys', () => {
    expect(parseAfterCallIdempotencyKey(IDEM, CALL)).toEqual({
      ok: true,
      key: IDEM,
      isTemplateRetry: false,
    })
    expect(
      parseAfterCallIdempotencyKey(`after-call:${CALL}:template`, CALL),
    ).toEqual({
      ok: true,
      key: `after-call:${CALL}:template`,
      isTemplateRetry: true,
    })
    expect(parseAfterCallIdempotencyKey('other', CALL).ok).toBe(false)
  })
})

describe('countTemplateVariables', () => {
  it('counts {{n}} placeholders', () => {
    expect(countTemplateVariables('Hi {{1}}, {{2}}')).toBe(2)
    expect(countTemplateVariables('Hello World')).toBe(0)
  })
})

describe('sendAfterCallMessage', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends template and stores durable idempotency', async () => {
    const db = makeDb({ config: goodConfig })
    const sendTemplateFn = vi.fn(async () => ({ messageId: 'wamid.1' }))
    const parsed = parseAfterCallSendBody(baseBody())
    expect(parsed.ok).toBe(true)
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
    expect(sendTemplateFn).toHaveBeenCalledTimes(1)
    expect(db._idem).toHaveLength(1)

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

  it('dry_run returns ok+dry_run without message_id and skips Meta', async () => {
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
  })

  it('returns 409 window_closed for text outside the 24h window', async () => {
    const db = makeDb({
      config: goodConfig,
      contacts: [{ id: 'c1', account_id: ACCOUNT, phone_normalized: '919876543210' }],
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
  })

  it('sends text when window is open', async () => {
    const now = new Date('2026-10-28T12:00:00Z')
    const db = makeDb({
      config: goodConfig,
      contacts: [{ id: 'c1', account_id: ACCOUNT, phone_normalized: '919876543210' }],
      conversations: [
        {
          id: 'conv1',
          account_id: ACCOUNT,
          contact_id: 'c1',
          channel: 'whatsapp',
          last_message_at: '2026-10-28T11:00:00Z',
        },
      ],
      messages: [
        {
          conversation_id: 'conv1',
          sender_type: 'customer',
          created_at: '2026-10-28T11:00:00Z',
        },
      ],
    })
    const sendTextFn = vi.fn(async () => ({ messageId: 'wamid.text' }))
    const parsed = parseAfterCallSendBody(
      baseBody({ type: 'text', text: 'Thanks', template: undefined }),
    )
    if (!parsed.ok) return
    const r = await sendAfterCallMessage({
      db,
      accountId: ACCOUNT,
      body: parsed.body,
      idempotencyKey: IDEM,
      sendTextFn,
      dryRun: false,
      now,
    })
    expect(r).toMatchObject({
      ok: true,
      body: { ok: true, message_id: 'wamid.text' },
    })
    expect(sendTextFn).toHaveBeenCalled()
  })

  it('maps Meta template miss to 422 template_not_found', async () => {
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
        {
          name: 'call_followup',
          language: 'en_US',
          category: 'UTILITY',
          status: 'APPROVED',
          body_text: 'Hi {{1}}, {{2}} {{3}} {{4}}',
          meta_template_id: '2',
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
    expect(r.templates.map((t) => t.name).sort()).toEqual([
      'call_followup',
      'hello_world',
    ])
    const followup = r.templates.find((t) => t.name === 'call_followup')
    expect(followup?.variable_count).toBe(4)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AFTER_CALL_SEND_KIND,
  clearAfterCallIdempotencyForTests,
  isAfterCallTemplatesEnabled,
  listApprovedTemplates,
  parseAfterCallSendBody,
  sendAfterCallTemplate,
} from './after-call-templates'
import { MetaApiError } from '@/lib/whatsapp/meta-api'

const TENANT = 'tenant_abc'
const PHONE = '106540352242922'
const ACCOUNT = 'acct-1'
const REQUEST = 'req_01HTEST000000000000000001'

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
      name: 'visit_reminder',
      category: 'Utility',
      language: 'en_US',
      body_text: 'Hello {{1}}',
      status: 'APPROVED',
      created_at: '2026-01-01T00:00:00Z',
    },
    malformed: false,
    language: 'en_US',
  })),
}))

function makeDb(opts: {
  config?: Record<string, unknown> | null
  templates?: Record<string, unknown>[]
}) {
  return {
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
          then(resolve: (v: typeof result) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(result).then(resolve, reject)
          },
        }
        return {
          select() {
            return chain
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
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

describe('parseAfterCallSendBody', () => {
  it('accepts a valid payload', () => {
    const parsed = parseAfterCallSendBody({
      kind: AFTER_CALL_SEND_KIND,
      tenant_id: TENANT,
      phone_number_id: PHONE,
      to: '+919876543210',
      template_name: 'visit_reminder',
      request_id: REQUEST,
      body_params: ['Ada'],
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.body.to).toBe('919876543210')
  })

  it('rejects wrong kind', () => {
    const parsed = parseAfterCallSendBody({
      kind: 'whatsapp.inbound',
      tenant_id: TENANT,
      phone_number_id: PHONE,
      to: '919876543210',
      template_name: 'x',
      request_id: REQUEST,
    })
    expect(parsed.ok).toBe(false)
  })
})

describe('sendAfterCallTemplate', () => {
  beforeEach(() => {
    clearAfterCallIdempotencyForTests()
    vi.stubEnv(
      'ENCRYPTION_KEY',
      '0000000000000000000000000000000000000000000000000000000000000000',
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    clearAfterCallIdempotencyForTests()
  })

  const baseBody = {
    kind: AFTER_CALL_SEND_KIND,
    tenant_id: TENANT,
    phone_number_id: PHONE,
    to: '919876543210',
    template_name: 'visit_reminder',
    request_id: REQUEST,
    body_params: ['Ada'],
  } as const

  const config = {
    id: 'cfg-1',
    account_id: ACCOUNT,
    phone_number_id: PHONE,
    access_token: 'enc-token',
    waba_id: 'waba-1',
    astra_connect_tenant_id: TENANT,
    status: 'connected',
  }

  it('returns dry-run without calling Meta', async () => {
    const sendFn = vi.fn()
    const result = await sendAfterCallTemplate({
      db: makeDb({ config }) as never,
      accountId: ACCOUNT,
      body: { ...baseBody },
      sendFn: sendFn as never,
      dryRun: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dry_run).toBe(true)
      expect(result.message_id.startsWith('dry-run-')).toBe(true)
      expect(result.replay).toBe(false)
    }
    expect(sendFn).not.toHaveBeenCalled()
  })

  it('is idempotent on request_id replay', async () => {
    const sendFn = vi.fn(async () => ({ messageId: 'wamid.1' }))
    const first = await sendAfterCallTemplate({
      db: makeDb({ config }) as never,
      accountId: ACCOUNT,
      body: { ...baseBody },
      sendFn: sendFn as never,
      dryRun: false,
    })
    const second = await sendAfterCallTemplate({
      db: makeDb({ config }) as never,
      accountId: ACCOUNT,
      body: { ...baseBody },
      sendFn: sendFn as never,
      dryRun: false,
    })
    expect(first.ok && second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(second.replay).toBe(true)
      expect(second.message_id).toBe(first.message_id)
    }
    expect(sendFn).toHaveBeenCalledTimes(1)
  })

  it('returns 404 on cross-tenant phone_number_id', async () => {
    const result = await sendAfterCallTemplate({
      db: makeDb({
        config: { ...config, phone_number_id: '999999999999999' },
      }) as never,
      accountId: ACCOUNT,
      body: { ...baseBody },
      dryRun: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.code).toBe('phone_number_id_mismatch')
    }
  })

  it('maps MetaApiError to 400/meta_error', async () => {
    const sendFn = vi.fn(async () => {
      throw new MetaApiError('Invalid parameter', {
        httpStatus: 400,
        code: 100,
        subcode: null,
        details: 'template not found',
      })
    })
    const result = await sendAfterCallTemplate({
      db: makeDb({ config }) as never,
      accountId: ACCOUNT,
      body: { ...baseBody },
      sendFn: sendFn as never,
      dryRun: false,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.code).toBe('meta_error')
      expect(result.error).toMatch(/template not found|Invalid/)
    }
  })

  it('succeeds through the Graph send path', async () => {
    const sendFn = vi.fn(async () => ({ messageId: 'wamid.success' }))
    const result = await sendAfterCallTemplate({
      db: makeDb({ config }) as never,
      accountId: ACCOUNT,
      body: { ...baseBody },
      sendFn: sendFn as never,
      dryRun: false,
    })
    expect(result).toMatchObject({
      ok: true,
      message_id: 'wamid.success',
      dry_run: false,
      replay: false,
    })
    expect(sendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: PHONE,
        templateName: 'visit_reminder',
        accountId: ACCOUNT,
        accessToken: 'plain-meta-token',
      }),
    )
  })
})

describe('listApprovedTemplates', () => {
  it('filters to APPROVED only', async () => {
    const result = await listApprovedTemplates({
      db: makeDb({
        config: {
          id: 'cfg-1',
          account_id: ACCOUNT,
          phone_number_id: PHONE,
          access_token: 'enc-token',
          waba_id: 'waba-1',
          astra_connect_tenant_id: TENANT,
        },
        templates: [
          {
            name: 'ok',
            language: 'en_US',
            category: 'Utility',
            status: 'APPROVED',
            body_text: 'hi',
            meta_template_id: '1',
          },
          {
            name: 'pending',
            language: 'en_US',
            category: 'Utility',
            status: 'PENDING',
            body_text: 'no',
            meta_template_id: '2',
          },
        ],
      }) as never,
      accountId: ACCOUNT,
      tenantId: TENANT,
      phoneNumberId: PHONE,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // DB query already filters status=APPROVED; JS filter is belt+suspenders.
      expect(result.templates.every((t) => t.status === 'APPROVED')).toBe(true)
      expect(result.templates.map((t) => t.name)).toContain('ok')
      expect(result.templates.map((t) => t.name)).not.toContain('pending')
      expect(result.waba_id).toBe('waba-1')
    }
  })

  it('returns 404 for phone owned by another config', async () => {
    const result = await listApprovedTemplates({
      db: makeDb({
        config: {
          id: 'cfg-1',
          account_id: ACCOUNT,
          phone_number_id: '111',
          access_token: 'enc-token',
          astra_connect_tenant_id: TENANT,
        },
      }) as never,
      accountId: ACCOUNT,
      tenantId: TENANT,
      phoneNumberId: PHONE,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

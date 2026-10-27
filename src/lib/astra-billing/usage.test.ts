import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  postSignedJson: vi.fn(
    async (_opts: {
      path: string
      rawBody: string
      baseUrl?: string
      secret?: string
      retryOnRateLimit?: boolean
      timeoutMs?: number
    }) => ({
      ok: true,
      status: 200,
      data: {},
    }),
  ),
}))

vi.mock('@/lib/astra-connect/client', () => ({
  postSignedJson: h.postSignedJson,
}))

import {
  billingWebhookSecret,
  billingWebhookUrl,
  buildUsageEventPayload,
  emitBillingUsageWebhook,
  recordWhatsappUsage,
  utcDayString,
} from './usage'

function usageDb(seed?: {
  account_id: string
  day: string
  inbound_messages: number
  outbound_messages: number
  template_sends: number
  conversations: number
}) {
  const state = {
    row: seed ? { ...seed } : null as null | Record<string, unknown>,
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  }

  const db = {
    from: (table: string) => {
      expect(table).toBe('astra_usage_daily')
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.row, error: null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: async () => {
              state.updates.push(patch)
              if (state.row) Object.assign(state.row, patch)
              return { data: null, error: null }
            },
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          state.inserts.push(row)
          state.row = { ...row }
          return { data: row, error: null }
        },
      }
    },
  }

  return { db, state }
}

describe('utcDayString', () => {
  it('returns YYYY-MM-DD in UTC', () => {
    expect(utcDayString(new Date('2026-10-27T23:59:59.000Z'))).toBe('2026-10-27')
    expect(utcDayString(new Date('2026-10-28T00:00:00.000Z'))).toBe('2026-10-28')
  })
})

describe('buildUsageEventPayload', () => {
  it('fills defaults for quantity / day / occurred_at', () => {
    const payload = buildUsageEventPayload({
      accountId: 'acct-1',
      kind: 'inbound_message',
      occurredAt: '2026-10-27T17:00:00.000Z',
      day: '2026-10-27',
    })
    expect(payload).toEqual({
      type: 'whatsapp.usage',
      account_id: 'acct-1',
      kind: 'inbound_message',
      quantity: 1,
      day: '2026-10-27',
      occurred_at: '2026-10-27T17:00:00.000Z',
    })
  })
})

describe('billingWebhookUrl / billingWebhookSecret', () => {
  afterEach(() => {
    delete process.env.BILLING_WEBHOOK_URL
    delete process.env.BILLING_WEBHOOK_SECRET
    delete process.env.WACRM_ADAPTER_SECRET
  })

  it('returns null when URL unset', () => {
    expect(billingWebhookUrl()).toBeNull()
  })

  it('strips trailing slashes from URL', () => {
    process.env.BILLING_WEBHOOK_URL = 'https://billing.example/hook/'
    expect(billingWebhookUrl()).toBe('https://billing.example/hook')
  })

  it('prefers BILLING_WEBHOOK_SECRET then falls back to WACRM_ADAPTER_SECRET', () => {
    expect(billingWebhookSecret()).toBeNull()
    process.env.WACRM_ADAPTER_SECRET = 'global-secret-16chars'
    expect(billingWebhookSecret()).toBe('global-secret-16chars')
    process.env.BILLING_WEBHOOK_SECRET = 'billing-secret-16c'
    expect(billingWebhookSecret()).toBe('billing-secret-16c')
  })

  it('rejects secrets shorter than 16 chars', () => {
    process.env.BILLING_WEBHOOK_SECRET = 'short'
    process.env.WACRM_ADAPTER_SECRET = 'also-short'
    expect(billingWebhookSecret()).toBeNull()
  })
})

describe('emitBillingUsageWebhook', () => {
  beforeEach(() => {
    h.postSignedJson.mockClear()
    delete process.env.BILLING_WEBHOOK_URL
    delete process.env.BILLING_WEBHOOK_SECRET
    delete process.env.WACRM_ADAPTER_SECRET
  })

  it('is a no-op when URL is unset', async () => {
    await emitBillingUsageWebhook(
      buildUsageEventPayload({ accountId: 'a', kind: 'outbound_message' }),
    )
    expect(h.postSignedJson).not.toHaveBeenCalled()
  })

  it('is a no-op when secret is missing', async () => {
    process.env.BILLING_WEBHOOK_URL = 'https://billing.example/hook'
    await emitBillingUsageWebhook(
      buildUsageEventPayload({ accountId: 'a', kind: 'outbound_message' }),
    )
    expect(h.postSignedJson).not.toHaveBeenCalled()
  })

  it('POSTs signed JSON to the configured URL', async () => {
    process.env.BILLING_WEBHOOK_URL = 'https://billing.example/v1/usage'
    process.env.BILLING_WEBHOOK_SECRET = 'billing-secret-16c'
    const payload = buildUsageEventPayload({
      accountId: 'acct-9',
      kind: 'template_send',
      quantity: 2,
      day: '2026-10-27',
      occurredAt: '2026-10-27T12:00:00.000Z',
    })
    await emitBillingUsageWebhook(payload)
    expect(h.postSignedJson).toHaveBeenCalledTimes(1)
    const call = h.postSignedJson.mock.calls[0]![0]
    expect(call.baseUrl).toBe('https://billing.example')
    expect(call.path).toBe('/v1/usage')
    expect(call.secret).toBe('billing-secret-16c')
    expect(call.retryOnRateLimit).toBe(false)
    expect(JSON.parse(call.rawBody)).toMatchObject({
      type: 'whatsapp.usage',
      account_id: 'acct-9',
      kind: 'template_send',
      quantity: 2,
    })
  })
})

describe('recordWhatsappUsage', () => {
  it('inserts a new daily row', async () => {
    const { db, state } = usageDb()
    const emit = vi.fn(async () => undefined)
    await recordWhatsappUsage({
      db,
      accountId: 'acct-1',
      kind: 'inbound_message',
      now: new Date('2026-10-27T15:00:00.000Z'),
      emit,
    })
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      account_id: 'acct-1',
      day: '2026-10-27',
      inbound_messages: 1,
      outbound_messages: 0,
      template_sends: 0,
      conversations: 0,
    })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'whatsapp.usage',
        account_id: 'acct-1',
        kind: 'inbound_message',
        quantity: 1,
        day: '2026-10-27',
      }),
    )
  })

  it('increments an existing daily row', async () => {
    const { db, state } = usageDb({
      account_id: 'acct-1',
      day: '2026-10-27',
      inbound_messages: 3,
      outbound_messages: 1,
      template_sends: 0,
      conversations: 1,
    })
    const emit = vi.fn(async () => undefined)
    await recordWhatsappUsage({
      db,
      accountId: 'acct-1',
      kind: 'outbound_message',
      quantity: 2,
      now: new Date('2026-10-27T18:00:00.000Z'),
      emit,
    })
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]).toMatchObject({
      outbound_messages: 3,
    })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'outbound_message', quantity: 2 }),
    )
  })

  it('never throws when the db fails', async () => {
    const db = {
      from: () => {
        throw new Error('boom')
      },
    }
    await expect(
      recordWhatsappUsage({
        db,
        accountId: 'acct-1',
        kind: 'conversation',
      }),
    ).resolves.toBeUndefined()
  })

  it('skips empty accountId / non-positive quantity', async () => {
    const { db, state } = usageDb()
    await recordWhatsappUsage({ db, accountId: '', kind: 'inbound_message' })
    await recordWhatsappUsage({
      db,
      accountId: 'acct-1',
      kind: 'inbound_message',
      quantity: 0,
    })
    expect(state.inserts).toHaveLength(0)
  })
})

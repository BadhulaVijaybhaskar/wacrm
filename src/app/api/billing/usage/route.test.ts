import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  billingWebhookUrl: vi.fn(() => null as string | null),
  createServiceClient: vi.fn(),
  supabase: { from: vi.fn() },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => {
    const message = err instanceof Error ? err.message : 'error'
    return new Response(JSON.stringify({ error: message }), { status: 401 })
  },
}))

vi.mock('@/lib/astra-billing/usage', () => ({
  billingWebhookUrl: h.billingWebhookUrl,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: h.createServiceClient,
}))

import { GET } from './route'

describe('GET /api/billing/usage', () => {
  beforeEach(() => {
    h.requireRole.mockReset().mockResolvedValue({
      accountId: 'acct-1',
    })
    h.billingWebhookUrl.mockReset().mockReturnValue(null)
    h.createServiceClient.mockReset().mockReturnValue(h.supabase)
    h.supabase.from.mockReset()
  })

  it('returns daily rows + totals for the account', async () => {
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      gte: vi.fn(() => api),
      order: vi.fn(async () => ({
        data: [
          {
            day: '2026-10-27',
            inbound_messages: 2,
            outbound_messages: 3,
            template_sends: 1,
            conversations: 1,
          },
          {
            day: '2026-10-26',
            inbound_messages: 1,
            outbound_messages: 0,
            template_sends: 0,
            conversations: 0,
          },
        ],
        error: null,
      })),
    }
    h.supabase.from.mockReturnValue(api)
    h.billingWebhookUrl.mockReturnValue('https://billing.example/hook')

    const res = await GET(
      new Request('http://localhost/api/billing/usage?days=7'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.billing_webhook_configured).toBe(true)
    expect(body.totals).toEqual({
      inbound_messages: 3,
      outbound_messages: 3,
      template_sends: 1,
      conversations: 1,
    })
    expect(body.rows).toHaveLength(2)
    expect(h.supabase.from).toHaveBeenCalledWith('astra_usage_daily')
  })
})

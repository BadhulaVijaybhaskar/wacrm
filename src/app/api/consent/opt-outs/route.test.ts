import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  applyConsentAction: vi.fn(async () => ({ optedOut: true })),
  supabase: { from: vi.fn() },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => {
    const message = err instanceof Error ? err.message : 'error'
    return new Response(JSON.stringify({ error: message }), { status: 401 })
  },
}))

vi.mock('@/lib/consent/ledger', () => ({
  applyConsentAction: h.applyConsentAction,
}))

import { GET, POST } from './route'

describe('/api/consent/opt-outs', () => {
  beforeEach(() => {
    h.requireRole.mockReset().mockResolvedValue({
      supabase: h.supabase,
      accountId: 'acct-1',
    })
    h.supabase.from.mockReset()
    h.applyConsentAction.mockClear()
  })

  it('GET lists opted-out contacts', async () => {
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      order: vi.fn(() => api),
      limit: vi.fn(async () => ({
        data: [{ id: 'c1', name: 'Ada', phone: '+1', opted_out: true }],
        error: null,
      })),
    }
    h.supabase.from.mockReturnValue(api)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.contacts).toHaveLength(1)
  })

  it('POST opt_out applies manual consent action', async () => {
    const api: Record<string, unknown> = {
      select: vi.fn(() => api),
      eq: vi.fn(() => api),
      maybeSingle: vi.fn(async () => ({ data: { id: 'c1' }, error: null })),
    }
    h.supabase.from.mockReturnValue(api)
    h.applyConsentAction.mockResolvedValue({ optedOut: true })

    const res = await POST(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ contact_id: 'c1', action: 'opt_out' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(h.applyConsentAction).toHaveBeenCalledWith(
      h.supabase,
      expect.objectContaining({
        contactId: 'c1',
        action: 'opt_out',
        source: 'manual',
      }),
    )
  })
})

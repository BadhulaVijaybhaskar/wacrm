import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetRateLimitForTests } from '@/lib/rate-limit'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    requireRole: mocks.requireRole,
  }
})

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}))

import { POST } from './route'

describe('POST /api/automations/engine — rate limit', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
    mocks.requireRole.mockReset()
    mocks.runAutomationsForTrigger.mockReset()
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.runAutomationsForTrigger.mockResolvedValue(undefined)
  })

  afterEach(() => {
    __resetRateLimitForTests()
  })

  it('returns 429 after the per-user send budget is exhausted', async () => {
    const body = JSON.stringify({ trigger_type: 'manual' })
    let last: Response | null = null
    for (let i = 0; i < 61; i += 1) {
      last = await POST(
        new Request('http://localhost/api/automations/engine', {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    expect(last?.status).toBe(429)
    expect(mocks.runAutomationsForTrigger.mock.calls.length).toBe(60)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resume: vi.fn(),
  health: vi.fn(),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => {
    const query = {
      select: () => query,
      update: () => query,
      eq: () => query,
      lte: () => query,
      order: () => query,
      limit: async () => ({
        data: [
          {
            id: 'row-1',
            automation_id: 'auto',
            account_id: 'acc',
            user_id: 'user',
            next_step_position: 1,
          },
        ],
        error: null,
      }),
      maybeSingle: async () => ({ data: { id: 'row-1' } }),
    }
    return { from: () => query }
  },
}))
vi.mock('@/lib/automations/engine', () => ({ resumePendingExecution: h.resume }))
vi.mock('@/lib/whatsapp/embedded-signup/health', () => ({
  checkScheduledConnections: h.health,
}))

function request() {
  return new Request('http://localhost/api/automations/cron', {
    headers: { 'x-cron-secret': 'secret' },
  })
}

async function loadRoute() {
  vi.resetModules()
  return import('./route')
}

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'secret')
  vi.stubEnv('WACRM_EMBEDDED_SIGNUP', '1')
  h.resume.mockReset().mockResolvedValue(undefined)
  h.health.mockReset().mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('automations cron health check', () => {
  it('still processes automations when the health check throws', async () => {
    h.health.mockRejectedValue(new Error('boom'))
    const { GET } = await loadRoute()
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ processed: 1 })
    expect(h.resume).toHaveBeenCalledTimes(1)
  })

  it('still responds when the health check hangs, within the time budget', async () => {
    vi.useFakeTimers()
    h.health.mockReturnValue(new Promise(() => {}))
    const { GET } = await loadRoute()
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(20_000)
    const response = await pending
    expect(await response.json()).toEqual({ processed: 1 })
    expect(h.resume).toHaveBeenCalledTimes(1)
    expect(h.health.mock.calls[0][0].signal.aborted).toBe(true)
  })

  it('runs the health check after automation processing', async () => {
    const order: string[] = []
    h.resume.mockImplementation(async () => void order.push('automation'))
    h.health.mockImplementation(async () => void order.push('health'))
    const { GET } = await loadRoute()
    await GET(request())
    expect(order).toEqual(['automation', 'health'])
  })

  it('runs the health check at most once per hour', async () => {
    const { GET } = await loadRoute()
    await GET(request())
    await GET(request())
    expect(h.health).toHaveBeenCalledTimes(1)
    expect(h.resume).toHaveBeenCalledTimes(2)
  })

  it('skips the health check when the feature flag is off', async () => {
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP', '')
    const { GET } = await loadRoute()
    await GET(request())
    expect(h.health).not.toHaveBeenCalled()
  })
})

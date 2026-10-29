import { afterEach, describe, expect, it, vi } from 'vitest'

describe('Graph API default version', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses v26.0 in the Graph URL when META_GRAPH_VERSION is unset', async () => {
    vi.stubEnv('META_GRAPH_VERSION', '')
    vi.resetModules()
    const { postCloudApiMessages } = await import('./meta-api')
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
        status: 200,
      }),
    )
    await postCloudApiMessages({
      phoneNumberId: '123',
      accessToken: 'token',
      body: {},
      skipChannelGate: true,
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    const calls = fetchFn.mock.calls as unknown as Array<[string]>
    expect(calls[0][0]).toContain('/v26.0/')
  })
})

import { afterEach, describe, expect, it } from 'vitest'

describe('GET /api/health', () => {
  const prev = {
    GIT_COMMIT: process.env.GIT_COMMIT,
    COMMIT_SHA: process.env.COMMIT_SHA,
    SOURCE_COMMIT: process.env.SOURCE_COMMIT,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('returns status ok and version with no other data', async () => {
    delete process.env.GIT_COMMIT
    delete process.env.COMMIT_SHA
    delete process.env.SOURCE_COMMIT
    delete process.env.VERCEL_GIT_COMMIT_SHA

    const { GET } = await import('./route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok', version: 'unknown' })
    expect(Object.keys(body).sort()).toEqual(['status', 'version'])
  })

  it('prefers GIT_COMMIT for version', async () => {
    process.env.GIT_COMMIT = 'abc1234deadbeef'
    process.env.VERCEL_GIT_COMMIT_SHA = 'should-not-win'

    const { GET } = await import('./route')
    const res = await GET()
    await expect(res.json()).resolves.toEqual({
      status: 'ok',
      version: 'abc1234deadbeef',
    })
  })
})

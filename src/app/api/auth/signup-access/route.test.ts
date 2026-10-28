import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: h.createClient,
}))

import { GET } from './route'

describe('GET /api/auth/signup-access', () => {
  const prevMode = process.env.WACRM_SIGNUP_MODE
  const prevList = process.env.WACRM_SIGNUP_ALLOWLIST

  beforeEach(() => {
    h.createClient.mockReset()
    h.createClient.mockResolvedValue({
      auth: {
        getUser: async () => ({ data: { user: null } }),
      },
    })
  })

  afterEach(() => {
    if (prevMode === undefined) delete process.env.WACRM_SIGNUP_MODE
    else process.env.WACRM_SIGNUP_MODE = prevMode
    if (prevList === undefined) delete process.env.WACRM_SIGNUP_ALLOWLIST
    else process.env.WACRM_SIGNUP_ALLOWLIST = prevList
  })

  it('defaults to open and allows signup', async () => {
    delete process.env.WACRM_SIGNUP_MODE
    const res = await GET(
      new Request('https://chat.example/api/auth/signup-access?email=a@b.com'),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      mode: 'open',
      may_signup: true,
      may_auto_create_owner: true,
    })
  })

  it('invite mode blocks strangers', async () => {
    process.env.WACRM_SIGNUP_MODE = 'invite'
    process.env.WACRM_SIGNUP_ALLOWLIST = 'ok@acme.com'
    const res = await GET(
      new Request(
        'https://chat.example/api/auth/signup-access?email=stranger@x.com',
      ),
    )
    const body = await res.json()
    expect(body.mode).toBe('invite')
    expect(body.may_signup).toBe(false)
    expect(body.may_auto_create_owner).toBe(false)
    expect(body.reason).toBe('invite_only')
  })

  it('invite mode allows allowlisted emails', async () => {
    process.env.WACRM_SIGNUP_MODE = 'invite'
    process.env.WACRM_SIGNUP_ALLOWLIST = '@acme.com'
    const res = await GET(
      new Request(
        'https://chat.example/api/auth/signup-access?email=dev@acme.com',
      ),
    )
    await expect(res.json()).resolves.toMatchObject({
      may_signup: true,
      may_auto_create_owner: true,
      allowlisted: true,
    })
  })

  it('invite token allows may_signup and owner bootstrap', async () => {
    process.env.WACRM_SIGNUP_MODE = 'invite'
    delete process.env.WACRM_SIGNUP_ALLOWLIST
    const res = await GET(
      new Request(
        'https://chat.example/api/auth/signup-access?email=x@y.com&invite=tok_abc',
      ),
    )
    await expect(res.json()).resolves.toMatchObject({
      may_signup: true,
      may_auto_create_owner: true,
      has_invite_token: true,
      reason: 'invite_token_bootstrap',
    })
  })
})

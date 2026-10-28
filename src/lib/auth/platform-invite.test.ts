import { describe, expect, it } from 'vitest'
import {
  authorizePlatformMint,
  mintPlatformInvite,
  secretsEqual,
} from './platform-invite'

describe('secretsEqual / authorizePlatformMint', () => {
  it('compares secrets in constant time', () => {
    expect(secretsEqual('abc', 'abc')).toBe(true)
    expect(secretsEqual('abc', 'abd')).toBe(false)
    expect(secretsEqual('abc', 'abcd')).toBe(false)
  })

  it('accepts Bearer service-role key', () => {
    expect(
      authorizePlatformMint({
        authorizationHeader: 'Bearer svc-role-key',
        platformAdminSecretHeader: null,
        serviceRoleKey: 'svc-role-key',
        platformAdminSecret: undefined,
      }),
    ).toBe(true)
  })

  it('accepts x-platform-admin-secret', () => {
    expect(
      authorizePlatformMint({
        authorizationHeader: null,
        platformAdminSecretHeader: 'plat-secret',
        serviceRoleKey: 'svc',
        platformAdminSecret: 'plat-secret',
      }),
    ).toBe(true)
  })

  it('rejects missing / wrong credentials', () => {
    expect(
      authorizePlatformMint({
        authorizationHeader: 'Bearer nope',
        platformAdminSecretHeader: null,
        serviceRoleKey: 'svc-role-key',
        platformAdminSecret: 'plat',
      }),
    ).toBe(false)
    expect(
      authorizePlatformMint({
        authorizationHeader: null,
        platformAdminSecretHeader: null,
        serviceRoleKey: 'svc',
        platformAdminSecret: 'plat',
      }),
    ).toBe(false)
  })
})

describe('mintPlatformInvite', () => {
  const ACCOUNT = '11111111-1111-4111-8111-111111111111'

  function makeDb(opts: { account?: boolean; onInsert?: (row: Record<string, unknown>) => void }) {
    const rows: Record<string, unknown>[] = []
    return {
      _rows: rows,
      from(table: string) {
        if (table === 'accounts') {
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return {
                        data: opts.account === false ? null : { id: ACCOUNT },
                        error: null,
                      }
                    },
                  }
                },
              }
            },
          }
        }
        if (table === 'account_invitations') {
          return {
            insert(row: Record<string, unknown>) {
              opts.onInsert?.(row)
              const stored = {
                id: 'inv-1',
                ...row,
                created_at: '2026-10-28T00:00:00Z',
              }
              rows.push(stored)
              return {
                select() {
                  return {
                    async single() {
                      return { data: stored, error: null }
                    },
                  }
                },
              }
            },
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }
  }

  it('inserts minted_by_platform_admin = true', async () => {
    let inserted: Record<string, unknown> | null = null
    const db = makeDb({
      onInsert: (row) => {
        inserted = row
      },
    })
    const r = await mintPlatformInvite(db, {
      accountId: ACCOUNT,
      role: 'agent',
      label: 'voice onboarding',
      baseUrl: 'https://chat.example.com',
      now: new Date('2026-10-28T00:00:00Z'),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(inserted?.minted_by_platform_admin).toBe(true)
    expect(inserted?.account_id).toBe(ACCOUNT)
    expect(r.invitation.minted_by_platform_admin).toBe(true)
    expect(r.token.length).toBeGreaterThan(20)
    expect(r.url).toContain('/join/')
  })

  it('rejects unknown accounts', async () => {
    const db = makeDb({ account: false })
    const r = await mintPlatformInvite(db, {
      accountId: ACCOUNT,
      role: 'admin',
      baseUrl: 'https://chat.example.com',
    })
    expect(r).toEqual({
      ok: false,
      status: 404,
      error: 'Account not found',
    })
  })

  it('rejects owner role', async () => {
    const db = makeDb({})
    const r = await mintPlatformInvite(db, {
      accountId: ACCOUNT,
      role: 'owner',
      baseUrl: 'https://chat.example.com',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
  })
})

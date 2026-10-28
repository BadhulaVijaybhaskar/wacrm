import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyConnectProvisioned,
  isConnectProvisionedEnabled,
  parseConnectProvisionedBody,
  CONNECT_PROVISIONED_KIND,
} from './connect-provisioned'
import { encryptProvisionedAccessToken } from './provision-crypto'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'
const PROVISION = 'prov_01HTEST000000000000000000'
const ACCOUNT = 'acct-1'
const OWNER = 'user-owner-1'

function encToken(phone = PHONE, tenant = TENANT) {
  return encryptProvisionedAccessToken({
    plaintext: 'EAAG-live-token',
    tenantId: tenant,
    phoneNumberId: phone,
    adapterSecret: SECRET,
  }).accessTokenEnc
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    kind: CONNECT_PROVISIONED_KIND,
    tenant_id: TENANT,
    phone_number_id: PHONE,
    provision_id: PROVISION,
    access_token_enc: encToken(),
    waba_id: 'waba-1',
    ...over,
  }
}

describe('isConnectProvisionedEnabled', () => {
  it('is off by default', () => {
    expect(isConnectProvisionedEnabled({})).toBe(false)
    expect(isConnectProvisionedEnabled({ WACRM_CONNECT_PROVISIONED: '0' })).toBe(
      false,
    )
  })

  it('turns on for 1/true/yes/on', () => {
    expect(isConnectProvisionedEnabled({ WACRM_CONNECT_PROVISIONED: '1' })).toBe(
      true,
    )
    expect(
      isConnectProvisionedEnabled({ WACRM_CONNECT_PROVISIONED: 'true' }),
    ).toBe(true)
  })
})

describe('parseConnectProvisionedBody', () => {
  it('accepts a valid payload', () => {
    const parsed = parseConnectProvisionedBody(validBody())
    expect(parsed.ok).toBe(true)
  })

  it('rejects the wrong kind', () => {
    const parsed = parseConnectProvisionedBody(
      validBody({ kind: 'whatsapp.something_else' }),
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(/kind/)
  })
})

type Row = Record<string, unknown>

/** Lightweight thenable query builder for applyConnectProvisioned. */
function makeDb(opts: {
  prior?: Row | null
  claimed?: Row | null
  existing?: Row | null
  onProvisionInsert?: (row: Row) => { error: unknown }
  onConfigUpdate?: (patch: Row) => { data: Row; error: unknown }
  onConfigInsert?: (row: Row) => { data: Row; error: unknown }
}) {
  const provisions: Row[] = opts.prior ? [opts.prior] : []
  let configSelectCalls = 0

  return {
    from(table: string) {
      if (table === 'astra_connect_provisions') {
        return {
          select() {
            return {
              eq(_c: string, val: string) {
                return {
                  async maybeSingle() {
                    const row =
                      provisions.find((p) => p.provision_id === val) ?? null
                    return { data: row, error: null }
                  },
                }
              },
            }
          },
          async insert(row: Row) {
            if (opts.onProvisionInsert) return opts.onProvisionInsert(row)
            provisions.push(row)
            return { error: null }
          },
        }
      }

      if (table === 'whatsapp_config') {
        return {
          select(_cols: string) {
            const chain = {
              eq(_c: string, _v: string) {
                return chain
              },
              neq(_c: string, _v: string) {
                return chain
              },
              async maybeSingle() {
                configSelectCalls += 1
                // First select is the phone claim check.
                if (configSelectCalls === 1) {
                  return { data: opts.claimed ?? null, error: null }
                }
                return { data: opts.existing ?? null, error: null }
              },
            }
            return chain
          },
          update(patch: Row) {
            return {
              eq() {
                return {
                  select() {
                    return {
                      async single() {
                        if (opts.onConfigUpdate) return opts.onConfigUpdate(patch)
                        return {
                          data: {
                            id:
                              opts.existing?.id ??
                              opts.claimed?.id ??
                              'cfg-1',
                          },
                          error: null,
                        }
                      },
                    }
                  },
                }
              },
            }
          },
          insert(row: Row) {
            return {
              select() {
                return {
                  async single() {
                    if (opts.onConfigInsert) return opts.onConfigInsert(row)
                    return { data: { id: 'cfg-new' }, error: null }
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

describe('applyConnectProvisioned', () => {
  beforeEach(() => {
    vi.stubEnv(
      'ENCRYPTION_KEY',
      '0000000000000000000000000000000000000000000000000000000000000000',
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('upserts a new config and records provision_id', async () => {
    const result = await applyConnectProvisioned({
      db: makeDb({ existing: { id: 'cfg-1' } }) as never,
      accountId: ACCOUNT,
      body: validBody() as never,
      adapterSecret: SECRET,
      ownerUserId: OWNER,
    })
    expect(result).toEqual({
      ok: true,
      config_id: 'cfg-1',
      phone_number_id: PHONE,
      replay: false,
    })
  })

  it('is idempotent on provision_id replay', async () => {
    const result = await applyConnectProvisioned({
      db: makeDb({
        prior: {
          provision_id: PROVISION,
          config_id: 'cfg-prior',
          phone_number_id: PHONE,
          account_id: ACCOUNT,
        },
      }) as never,
      accountId: ACCOUNT,
      body: validBody() as never,
      adapterSecret: SECRET,
      ownerUserId: OWNER,
    })
    expect(result).toEqual({
      ok: true,
      config_id: 'cfg-prior',
      phone_number_id: PHONE,
      replay: true,
    })
  })

  it('returns 409 when phone_number_id is active for another tenant', async () => {
    const result = await applyConnectProvisioned({
      db: makeDb({
        claimed: {
          id: 'cfg-other',
          account_id: 'acct-other',
          astra_connect_tenant_id: 'tenant_other',
          status: 'connected',
        },
      }) as never,
      accountId: ACCOUNT,
      body: validBody() as never,
      adapterSecret: SECRET,
      ownerUserId: OWNER,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('phone_number_in_use')
    }
  })

  it('returns 400 when AAD does not match (tampered phone)', async () => {
    const body = validBody({
      access_token_enc: encToken('111111111111111'),
    })
    const result = await applyConnectProvisioned({
      db: makeDb({}) as never,
      accountId: ACCOUNT,
      body: body as never,
      adapterSecret: SECRET,
      ownerUserId: OWNER,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.code).toMatch(/bad_aad|bad_ciphertext/)
    }
  })

  it('returns 409 when a concurrent unique(phone_number_id) race loses', async () => {
    const result = await applyConnectProvisioned({
      db: makeDb({
        onConfigInsert: () => ({
          data: null as unknown as Row,
          error: {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "whatsapp_config_phone_number_id_key"',
            details: 'Key (phone_number_id)=(106540352242922) already exists.',
            constraint: 'whatsapp_config_phone_number_id_key',
          },
        }),
      }) as never,
      accountId: ACCOUNT,
      body: validBody() as never,
      adapterSecret: SECRET,
      ownerUserId: OWNER,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(409)
      expect(result.code).toBe('phone_number_in_use')
    }
  })
})

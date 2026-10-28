import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from '@/lib/astra-connect/sign'
import { encryptProvisionedAccessToken } from '@/lib/astra-connect/provision-crypto'
import { CONNECT_PROVISIONED_KIND } from '@/lib/astra-connect/connect-provisioned'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'
const PROVISION = 'prov_01HTEST000000000000000000'
const ACCOUNT = 'acct-1'

const h = vi.hoisted(() => ({
  authenticateConnectRequest: vi.fn(),
  applyConnectProvisioned: vi.fn(),
}))

vi.mock('@/lib/astra-connect/read-auth', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/astra-connect/read-auth')
  >('@/lib/astra-connect/read-auth')
  return {
    ...actual,
    authenticateConnectRequest: h.authenticateConnectRequest,
  }
})

vi.mock('@/lib/astra-connect/connect-provisioned', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/astra-connect/connect-provisioned')
  >('@/lib/astra-connect/connect-provisioned')
  return {
    ...actual,
    applyConnectProvisioned: h.applyConnectProvisioned,
  }
})

import { POST } from './route'

function body(over: Record<string, unknown> = {}) {
  const access_token_enc = encryptProvisionedAccessToken({
    plaintext: 'EAAG-token',
    tenantId: TENANT,
    phoneNumberId: PHONE,
    adapterSecret: SECRET,
  }).accessTokenEnc
  return {
    kind: CONNECT_PROVISIONED_KIND,
    tenant_id: TENANT,
    phone_number_id: PHONE,
    provision_id: PROVISION,
    access_token_enc,
    ...over,
  }
}

function signedRequest(
  payload: object,
  opts: {
    tenantHeader?: string
    timestamp?: number
    badSig?: boolean
  } = {},
) {
  const raw = JSON.stringify(payload)
  const tenant =
    opts.tenantHeader ??
    (typeof (payload as { tenant_id?: string }).tenant_id === 'string'
      ? (payload as { tenant_id: string }).tenant_id
      : TENANT)
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000)
  const sig = opts.badSig
    ? 'sha256=deadbeef'
    : buildAstraSignature(`${raw}.${tenant}`, SECRET, ts)
  return new Request(
    'https://chat.example/api/astra-connect/v1/whatsapp/connect-provisioned',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Astra-Timestamp': String(ts),
        'X-Astra-Signature': sig,
        'X-Astra-Tenant': tenant,
      },
      body: raw,
    },
  )
}

describe('POST /api/astra-connect/v1/whatsapp/connect-provisioned', () => {
  const prevFlag = process.env.WACRM_CONNECT_PROVISIONED
  const prevSecret = process.env.WACRM_ADAPTER_SECRET

  beforeEach(() => {
    process.env.WACRM_CONNECT_PROVISIONED = '1'
    process.env.WACRM_ADAPTER_SECRET = SECRET
    h.authenticateConnectRequest.mockReset()
    h.applyConnectProvisioned.mockReset()
  })

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.WACRM_CONNECT_PROVISIONED
    else process.env.WACRM_CONNECT_PROVISIONED = prevFlag
    if (prevSecret === undefined) delete process.env.WACRM_ADAPTER_SECRET
    else process.env.WACRM_ADAPTER_SECRET = prevSecret
  })

  it('returns 404 when the feature flag is off', async () => {
    delete process.env.WACRM_CONNECT_PROVISIONED
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(404)
    expect(h.authenticateConnectRequest).not.toHaveBeenCalled()
  })

  it('rejects wrong kind with 400', async () => {
    const res = await POST(
      signedRequest(body({ kind: 'whatsapp.inbound' })),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/kind/),
    })
  })

  it('accepts a valid signature and returns 200', async () => {
    const db = {
      from(table: string) {
        if (table === 'accounts') {
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return {
                        data: { id: ACCOUNT, owner_user_id: 'user-1' },
                        error: null,
                      }
                    },
                  }
                },
              }
            },
          }
        }
        throw new Error(table)
      },
    }
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: ACCOUNT,
        tenantId: TENANT,
        phoneNumberId: null,
        employeeId: null,
        enabled: true,
        db,
      },
    })
    h.applyConnectProvisioned.mockResolvedValue({
      ok: true,
      config_id: 'cfg-1',
      phone_number_id: PHONE,
      replay: false,
    })

    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      config_id: 'cfg-1',
      phone_number_id: PHONE,
    })
    expect(h.authenticateConnectRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        rawBody: expect.stringContaining(CONNECT_PROVISIONED_KIND),
      }),
    )
  })

  it('propagates auth 401 for bad signature', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
      }),
    })
    const res = await POST(signedRequest(body(), { badSig: true }))
    expect(res.status).toBe(401)
  })

  it('propagates auth 401 for stale timestamp', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'Invalid or expired timestamp' }),
        { status: 401 },
      ),
    })
    const res = await POST(
      signedRequest(body(), { timestamp: Math.floor(Date.now() / 1000) - 10_000 }),
    )
    expect(res.status).toBe(401)
  })

  it('propagates auth 404 for tenant header mismatch', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
      }),
    })
    const res = await POST(
      signedRequest(body(), { tenantHeader: 'other_tenant' }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 409 from apply when phone is in use', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: ACCOUNT,
        tenantId: TENANT,
        phoneNumberId: null,
        employeeId: null,
        enabled: true,
        db: {
          from() {
            return {
              select() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return {
                          data: { id: ACCOUNT, owner_user_id: 'user-1' },
                          error: null,
                        }
                      },
                    }
                  },
                }
              },
            }
          },
        },
      },
    })
    h.applyConnectProvisioned.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'phone_number_id is already active for another tenant',
      code: 'phone_number_in_use',
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(409)
  })
})

describe('§13 signing vector for connect-provisioned', () => {
  it('signs rawBody.tenant_id (not empty body)', () => {
    const raw = JSON.stringify(body())
    const ts = 1_700_000_000
    const sig = buildAstraSignature(`${raw}.${TENANT}`, SECRET, ts)
    expect(sig.startsWith('sha256=')).toBe(true)
    expect(sig).not.toBe(buildAstraSignature('', SECRET, ts))
    expect(sig).not.toBe(buildAstraSignature(raw, SECRET, ts))
  })
})

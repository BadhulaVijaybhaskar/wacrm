import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from '@/lib/astra-connect/sign'
import { AFTER_CALL_SEND_KIND } from '@/lib/astra-connect/after-call-templates'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'

const h = vi.hoisted(() => ({
  authenticateConnectRequest: vi.fn(),
  sendAfterCallMessage: vi.fn(),
  isAfterCallTemplatesEnabled: vi.fn(),
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

vi.mock('@/lib/astra-connect/after-call-templates', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/astra-connect/after-call-templates')
  >('@/lib/astra-connect/after-call-templates')
  return {
    ...actual,
    sendAfterCallMessage: h.sendAfterCallMessage,
    isAfterCallTemplatesEnabled: h.isAfterCallTemplatesEnabled,
  }
})

import { POST } from './route'

function body(over: Record<string, unknown> = {}) {
  return {
    kind: AFTER_CALL_SEND_KIND,
    send_id: 'wac_0123456789abcdef',
    tenant_id: TENANT,
    employee_id: 'emp_a',
    call_id: 'call_1',
    phone_number_id: PHONE,
    waba_id: '200000000000002',
    to: '+919876543210',
    type: 'template',
    template: {
      name: 'hello_world',
      language: 'en_US',
      variables: [],
    },
    ...over,
  }
}

function signedRequest(
  payload: object,
  opts: { idempotencyKey?: string } = {},
) {
  const raw = JSON.stringify(payload)
  const ts = Math.floor(Date.now() / 1000)
  const sig = buildAstraSignature(`${raw}.${TENANT}`, SECRET, ts)
  return new Request(
    'https://chat.example/api/astra-connect/v1/whatsapp/send',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Astra-Timestamp': String(ts),
        'X-Astra-Signature': sig,
        'X-Astra-Tenant': TENANT,
        'Idempotency-Key':
          opts.idempotencyKey ?? 'after-call:call_1',
      },
      body: raw,
    },
  )
}

describe('POST /api/astra-connect/v1/whatsapp/send', () => {
  beforeEach(() => {
    h.authenticateConnectRequest.mockReset()
    h.sendAfterCallMessage.mockReset()
    h.isAfterCallTemplatesEnabled.mockReset()
    h.isAfterCallTemplatesEnabled.mockReturnValue(true)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 404 when the feature flag is off', async () => {
    h.isAfterCallTemplatesEnabled.mockReturnValue(false)
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(404)
    expect(h.authenticateConnectRequest).not.toHaveBeenCalled()
  })

  it('returns 400 bad_kind for wrong kind', async () => {
    const res = await POST(
      signedRequest(body({ kind: 'whatsapp.template_send' })),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'bad_kind' })
  })

  it('returns 400 missing_idempotency_key', async () => {
    const raw = JSON.stringify(body())
    const ts = Math.floor(Date.now() / 1000)
    const sig = buildAstraSignature(`${raw}.${TENANT}`, SECRET, ts)
    const req = new Request(
      'https://chat.example/api/astra-connect/v1/whatsapp/send',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Astra-Timestamp': String(ts),
          'X-Astra-Signature': sig,
          'X-Astra-Tenant': TENANT,
        },
        body: raw,
      },
    )
    const res = await POST(req)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'missing_idempotency_key',
    })
  })

  it('propagates auth 401 for bad signature', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
      }),
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(401)
  })

  it('returns 200 on success', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: 'acct-1',
        tenantId: TENANT,
        phoneNumberId: PHONE,
        employeeId: null,
        enabled: true,
        db: {},
      },
    })
    h.sendAfterCallMessage.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, message_id: 'wamid.1' },
      replay: false,
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      message_id: 'wamid.1',
    })
  })

  it('returns dry_run:true with no message_id', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: 'acct-1',
        tenantId: TENANT,
        phoneNumberId: PHONE,
        employeeId: null,
        enabled: true,
        db: {},
      },
    })
    h.sendAfterCallMessage.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ok: true, dry_run: true },
      replay: false,
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, dry_run: true })
    expect(json).not.toHaveProperty('message_id')
  })

  it('returns 409 window_closed as {error}', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: 'acct-1',
        tenantId: TENANT,
        phoneNumberId: PHONE,
        employeeId: null,
        enabled: true,
        db: {},
      },
    })
    h.sendAfterCallMessage.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: 'window_closed' },
    })
    const res = await POST(
      signedRequest(
        body({
          type: 'text',
          text: 'Thanks for your call',
          template: undefined,
        }),
      ),
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'window_closed' })
  })

  it('maps Meta template_not_found 422', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: 'acct-1',
        tenantId: TENANT,
        phoneNumberId: PHONE,
        employeeId: null,
        enabled: true,
        db: {},
      },
    })
    h.sendAfterCallMessage.mockResolvedValue({
      ok: false,
      status: 422,
      body: { error: 'template_not_found' },
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({
      error: 'template_not_found',
    })
  })
})

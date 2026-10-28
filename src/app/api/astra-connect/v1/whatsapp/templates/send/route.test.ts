import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from '@/lib/astra-connect/sign'
import { AFTER_CALL_SEND_KIND } from '@/lib/astra-connect/after-call-templates'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'

const h = vi.hoisted(() => ({
  authenticateConnectRequest: vi.fn(),
  sendAfterCallTemplate: vi.fn(),
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
    sendAfterCallTemplate: h.sendAfterCallTemplate,
    isAfterCallTemplatesEnabled: h.isAfterCallTemplatesEnabled,
  }
})

import { POST } from './route'

function body(over: Record<string, unknown> = {}) {
  return {
    kind: AFTER_CALL_SEND_KIND,
    tenant_id: TENANT,
    phone_number_id: PHONE,
    to: '919876543210',
    template_name: 'visit_reminder',
    request_id: 'req_1',
    ...over,
  }
}

function signedRequest(payload: object) {
  const raw = JSON.stringify(payload)
  const ts = Math.floor(Date.now() / 1000)
  const sig = buildAstraSignature(`${raw}.${TENANT}`, SECRET, ts)
  return new Request(
    'https://chat.example/api/astra-connect/v1/whatsapp/templates/send',
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
}

describe('POST /api/astra-connect/v1/whatsapp/templates/send', () => {
  beforeEach(() => {
    h.authenticateConnectRequest.mockReset()
    h.sendAfterCallTemplate.mockReset()
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
    h.sendAfterCallTemplate.mockResolvedValue({
      ok: true,
      message_id: 'wamid.1',
      request_id: 'req_1',
      dry_run: false,
      replay: false,
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      message_id: 'wamid.1',
    })
  })

  it('returns dry_run result', async () => {
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
    h.sendAfterCallTemplate.mockResolvedValue({
      ok: true,
      message_id: 'dry-run-abc',
      request_id: 'req_1',
      dry_run: true,
      replay: false,
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ dry_run: true })
  })

  it('maps Meta error from apply', async () => {
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
    h.sendAfterCallTemplate.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'template not found',
      code: 'meta_error',
    })
    const res = await POST(signedRequest(body()))
    expect(res.status).toBe(400)
  })
})

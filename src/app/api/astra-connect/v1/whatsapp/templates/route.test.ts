import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from '@/lib/astra-connect/sign'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'

const h = vi.hoisted(() => ({
  authenticateConnectRequest: vi.fn(),
  listApprovedTemplates: vi.fn(),
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
    listApprovedTemplates: h.listApprovedTemplates,
    isAfterCallTemplatesEnabled: h.isAfterCallTemplatesEnabled,
  }
})

import { GET } from './route'

function signedGet(path: string) {
  const ts = Math.floor(Date.now() / 1000)
  const url = new URL(path, 'https://chat.example')
  const canonical = `${url.pathname}${url.search}.${TENANT}`
  const sig = buildAstraSignature(canonical, SECRET, ts)
  return new Request(url, {
    method: 'GET',
    headers: {
      'X-Astra-Timestamp': String(ts),
      'X-Astra-Signature': sig,
      'X-Astra-Tenant': TENANT,
    },
  })
}

describe('GET /api/astra-connect/v1/whatsapp/templates', () => {
  beforeEach(() => {
    h.authenticateConnectRequest.mockReset()
    h.listApprovedTemplates.mockReset()
    h.isAfterCallTemplatesEnabled.mockReset()
    h.isAfterCallTemplatesEnabled.mockReturnValue(true)
  })

  it('returns 404 when flag is off', async () => {
    h.isAfterCallTemplatesEnabled.mockReturnValue(false)
    const res = await GET(
      signedGet(
        `/api/astra-connect/v1/whatsapp/templates?tenant_id=${TENANT}&phone_number_id=${PHONE}`,
      ),
    )
    expect(res.status).toBe(404)
  })

  it('requires tenant_id and phone_number_id', async () => {
    const res = await GET(
      signedGet(`/api/astra-connect/v1/whatsapp/templates?tenant_id=${TENANT}`),
    )
    expect(res.status).toBe(400)
    expect(h.authenticateConnectRequest).not.toHaveBeenCalled()
  })

  it('lists APPROVED templates', async () => {
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
    h.listApprovedTemplates.mockResolvedValue({
      ok: true,
      templates: [
        {
          name: 'visit_reminder',
          language: 'en_US',
          category: 'Utility',
          status: 'APPROVED',
          body_text: 'Hi',
          meta_template_id: '1',
          waba_id: 'waba-1',
        },
      ],
      phone_number_id: PHONE,
      waba_id: 'waba-1',
    })
    const res = await GET(
      signedGet(
        `/api/astra-connect/v1/whatsapp/templates?tenant_id=${TENANT}&phone_number_id=${PHONE}`,
      ),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.templates).toHaveLength(1)
    expect(json.templates[0].status).toBe('APPROVED')
  })

  it('propagates auth failure', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
      }),
    })
    const res = await GET(
      signedGet(
        `/api/astra-connect/v1/whatsapp/templates?tenant_id=${TENANT}&phone_number_id=${PHONE}`,
      ),
    )
    expect(res.status).toBe(401)
  })
})

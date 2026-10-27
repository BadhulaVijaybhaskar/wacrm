import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from '@/lib/astra-connect/sign'

const h = vi.hoisted(() => ({
  authenticateConnectRequest: vi.fn(),
  listConnectConversations: vi.fn(),
  conversationListEtag: vi.fn(),
  consumeConnectRateLimit: vi.fn(),
}))

vi.mock('@/lib/astra-connect/read-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/astra-connect/read-auth')>(
    '@/lib/astra-connect/read-auth',
  )
  return {
    ...actual,
    authenticateConnectRequest: h.authenticateConnectRequest,
    consumeConnectRateLimit: h.consumeConnectRateLimit,
  }
})

vi.mock('@/lib/astra-connect/read-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/astra-connect/read-api')>(
    '@/lib/astra-connect/read-api',
  )
  return {
    ...actual,
    listConnectConversations: h.listConnectConversations,
    conversationListEtag: h.conversationListEtag,
  }
})

import { GET } from './route'

const SECRET = 'test-adapter-secret-16+'
const TENANT = 't_abc'

function signedGet(pathAndQuery: string, extraHeaders: Record<string, string> = {}) {
  const ts = Math.floor(Date.now() / 1000)
  const sig = buildAstraSignature(`${pathAndQuery}.${TENANT}`, SECRET, ts)
  return new Request(`https://chat.example${pathAndQuery}`, {
    method: 'GET',
    headers: {
      'X-Astra-Timestamp': String(ts),
      'X-Astra-Signature': sig,
      'X-Astra-Tenant': TENANT,
      ...extraHeaders,
    },
  })
}

describe('GET /api/astra-connect/v1/conversations', () => {
  beforeEach(() => {
    h.authenticateConnectRequest.mockReset()
    h.listConnectConversations.mockReset()
    h.conversationListEtag.mockReset()
    h.consumeConnectRateLimit.mockReset()
    h.consumeConnectRateLimit.mockReturnValue({
      success: true,
      remaining: 100,
      reset: Date.now() + 60_000,
      limit: 600,
    })
    h.conversationListEtag.mockResolvedValue('"2026-10-27T17:00:00.000Z:1"')
  })

  it('requires tenant_id', async () => {
    const res = await GET(
      signedGet('/api/astra-connect/v1/conversations?limit=10'),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when auth fails (unknown tenant / bad sig)', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
      }),
    })
    const res = await GET(
      signedGet(
        `/api/astra-connect/v1/conversations?tenant_id=${TENANT}&employee_id=emp_b`,
      ),
    )
    expect(res.status).toBe(404)
  })

  it('(a) lists conversations that include tenant_id', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: 'acct-a',
        tenantId: TENANT,
        phoneNumberId: '106540352242922',
        employeeId: 'emp_default',
        db: {},
      },
    })
    h.listConnectConversations.mockResolvedValue({
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          tenant_id: TENANT,
          astra_conversation_id: 'conv_1',
          employee_id: 'emp_1',
          phone_number_id: '106540352242922',
          status: 'open',
          handoff: 'ai',
          unread_count: 0,
          last_message_preview: 'hi',
          updated_at: '2026-10-27T17:00:00.000Z',
          assignee: null,
          labels: [],
          contact: {
            phone: '+919812345678',
            name: 'Priya',
            opted_out: false,
          },
        },
      ],
      next_cursor: null,
    })

    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}&employee_id=emp_1&handoff=ai&limit=50`
    const res = await GET(signedGet(path))
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"2026-10-27T17:00:00.000Z:1"')
    const body = await res.json()
    expect(body.conversations[0].tenant_id).toBe(TENANT)
    expect(body.conversations[0].phone_number_id).toBe('106540352242922')
    expect(h.listConnectConversations).toHaveBeenCalledWith(
      expect.objectContaining({ handoff: 'ai', employeeId: 'emp_1' }),
    )
    expect(h.consumeConnectRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'read', tenantId: TENANT }),
    )
  })

  it('rejects invalid handoff filter before auth/DB', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}&handoff=bot`
    const res = await GET(signedGet(path))
    expect(res.status).toBe(400)
    expect(h.authenticateConnectRequest).not.toHaveBeenCalled()
    expect(h.listConnectConversations).not.toHaveBeenCalled()
  })

  it('rejects non-integer limit before auth/DB', async () => {
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}&limit=abc`
    const res = await GET(signedGet(path))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/limit/i)
    expect(h.authenticateConnectRequest).not.toHaveBeenCalled()
  })

  it('(c) returns 304 when If-None-Match matches ETag', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: 'acct-a',
        tenantId: TENANT,
        phoneNumberId: '1',
        employeeId: null,
        db: {},
      },
    })
    const etag = '"2026-10-27T17:00:00.000Z:1"'
    h.conversationListEtag.mockResolvedValue(etag)
    const path = `/api/astra-connect/v1/conversations?tenant_id=${TENANT}`
    const res = await GET(
      signedGet(path, { 'If-None-Match': etag }),
    )
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(etag)
    expect(h.listConnectConversations).not.toHaveBeenCalled()
    expect(h.consumeConnectRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ cost: 0.25 }),
    )
  })
})

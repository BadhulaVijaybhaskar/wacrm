import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from '@/lib/astra-connect/sign'

const h = vi.hoisted(() => ({
  authenticateConnectRequest: vi.fn(),
  listConnectConversations: vi.fn(),
}))

vi.mock('@/lib/astra-connect/read-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/astra-connect/read-auth')>(
    '@/lib/astra-connect/read-auth',
  )
  return {
    ...actual,
    authenticateConnectRequest: h.authenticateConnectRequest,
  }
})

vi.mock('@/lib/astra-connect/read-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/astra-connect/read-api')>(
    '@/lib/astra-connect/read-api',
  )
  return {
    ...actual,
    listConnectConversations: h.listConnectConversations,
  }
})

import { GET } from './route'

const SECRET = 'test-adapter-secret-16+'

function signedGet(pathAndQuery: string) {
  const ts = Math.floor(Date.now() / 1000)
  const sig = buildAstraSignature(pathAndQuery, SECRET, ts)
  return new Request(`https://chat.example${pathAndQuery}`, {
    method: 'GET',
    headers: {
      'X-Astra-Timestamp': String(ts),
      'X-Astra-Signature': sig,
    },
  })
}

describe('GET /api/astra-connect/v1/conversations', () => {
  beforeEach(() => {
    h.authenticateConnectRequest.mockReset()
    h.listConnectConversations.mockReset()
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
        '/api/astra-connect/v1/conversations?tenant_id=t_other&employee_id=emp_b',
      ),
    )
    expect(res.status).toBe(404)
  })

  it('lists conversations filtered by employee_id for the tenant', async () => {
    h.authenticateConnectRequest.mockResolvedValue({
      ok: true,
      ctx: {
        accountId: 'acct-a',
        tenantId: 't_abc',
        phoneNumberId: '106540352242922',
        employeeId: 'emp_default',
        db: {},
      },
    })
    h.listConnectConversations.mockResolvedValue({
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          astra_conversation_id: 'conv_1',
          employee_id: 'emp_1',
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

    const path =
      '/api/astra-connect/v1/conversations?tenant_id=t_abc&employee_id=emp_1&limit=50'
    const res = await GET(signedGet(path))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.conversations).toHaveLength(1)
    expect(body.conversations[0].employee_id).toBe('emp_1')
    expect(h.listConnectConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: 'emp_1',
        phoneNumberId: null,
      }),
    )
  })
})

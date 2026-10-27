import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAstraSignature } from '@/lib/astra-connect/sign'
import { encodeCursor } from '@/lib/astra-connect/read-api'

const h = vi.hoisted(() => ({
  authenticateConnectRequest: vi.fn(),
  listConnectMessages: vi.fn(),
  messageListEtag: vi.fn(),
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
    listConnectMessages: h.listConnectMessages,
    messageListEtag: h.messageListEtag,
  }
})

import { GET } from './route'

const SECRET = 'test-adapter-secret-16+'
const TENANT = 't_abc'
const CONV = '11111111-1111-1111-1111-111111111111'

function signedGet(pathAndQuery: string, extra: Record<string, string> = {}) {
  const ts = Math.floor(Date.now() / 1000)
  const sig = buildAstraSignature(`${pathAndQuery}.${TENANT}`, SECRET, ts)
  return new Request(`https://chat.example${pathAndQuery}`, {
    method: 'GET',
    headers: {
      'X-Astra-Timestamp': String(ts),
      'X-Astra-Signature': sig,
      'X-Astra-Tenant': TENANT,
      ...extra,
    },
  })
}

describe('GET /api/astra-connect/v1/conversations/:id/messages', () => {
  beforeEach(() => {
    h.authenticateConnectRequest.mockReset()
    h.listConnectMessages.mockReset()
    h.messageListEtag.mockReset()
    h.consumeConnectRateLimit.mockReset()
    h.consumeConnectRateLimit.mockReturnValue({
      success: true,
      remaining: 100,
      reset: Date.now() + 60_000,
      limit: 600,
    })
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
    h.messageListEtag.mockResolvedValue('"2026-10-27T16:59:05.000Z:2"')
  })

  it('(a)+(e) returns conversation + messages with tenant_id and passes before cursor', async () => {
    const before = encodeCursor({
      updatedAt: '2026-10-27T16:59:00.000Z',
      id: '22222222-2222-2222-2222-222222222222',
    })
    h.listConnectMessages.mockResolvedValue({
      conversation: {
        id: CONV,
        tenant_id: TENANT,
        astra_conversation_id: 'conv_1',
        employee_id: 'emp_1',
        phone_number_id: '1065',
        status: 'open',
        handoff: 'ai',
        unread_count: 0,
        last_message_preview: 'older',
        updated_at: '2026-10-27T16:58:00.000Z',
        assignee: null,
        labels: [],
        contact: {
          phone: '+919812345678',
          name: 'Priya',
          opted_out: false,
        },
      },
      items: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          tenant_id: TENANT,
          direction: 'outbound',
          type: 'text',
          text: 'older',
          media: null,
          template_name: null,
          status: 'sent',
          failure_reason: null,
          sender: { kind: 'ai' },
          created_at: '2026-10-27T16:58:00.000Z',
          whatsapp_message_id: 'wamid.OLD',
        },
      ],
      next_cursor: null,
    })

    const path = `/api/astra-connect/v1/conversations/${CONV}/messages?tenant_id=${TENANT}&before=${encodeURIComponent(before)}&limit=50`
    const res = await GET(signedGet(path), {
      params: Promise.resolve({ id: CONV }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.conversation.id).toBe(CONV)
    expect(body.conversation.phone_number_id).toBe('1065')
    expect(body.messages[0].tenant_id).toBe(TENANT)
    expect(h.listConnectMessages).toHaveBeenCalledWith(
      expect.objectContaining({ before }),
    )
  })

  it('(c) returns 304 for matching If-None-Match', async () => {
    const etag = '"2026-10-27T16:59:05.000Z:2"'
    h.messageListEtag.mockResolvedValue(etag)
    const path = `/api/astra-connect/v1/conversations/${CONV}/messages?tenant_id=${TENANT}`
    const res = await GET(signedGet(path, { 'If-None-Match': etag }), {
      params: Promise.resolve({ id: CONV }),
    })
    expect(res.status).toBe(304)
    expect(h.listConnectMessages).not.toHaveBeenCalled()
    expect(h.consumeConnectRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ cost: 0.25 }),
    )
  })

  it('returns 404 when conversation is outside the tenant', async () => {
    h.messageListEtag.mockResolvedValue(null)
    const path = `/api/astra-connect/v1/conversations/${CONV}/messages?tenant_id=${TENANT}`
    const res = await GET(signedGet(path), {
      params: Promise.resolve({ id: CONV }),
    })
    expect(res.status).toBe(404)
  })
})

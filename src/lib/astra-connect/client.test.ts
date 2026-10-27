import { describe, it, expect, vi, beforeEach } from 'vitest'
import { postSignedJson } from './client'
import { buildAstraSignature } from './sign'

const SECRET = 'test-adapter-secret-16+'
const BASE = 'https://connect.test'
const payload = {
  tenant_id: 't_abc',
  phone_number_id: '106540352242922',
  customer_phone: '+919812345678',
  message_id: 'wamid.SAME',
  timestamp: '2026-10-27T15:04:05Z',
  text: 'hi',
}
const rawBody = JSON.stringify(payload)

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('postSignedJson — contract client', () => {
  const sleeps: number[] = []
  const sleep = vi.fn(async (ms: number) => {
    sleeps.push(ms)
  })

  beforeEach(() => {
    sleeps.length = 0
    sleep.mockClear()
  })

  it('signs with X-Astra-* headers over the exact rawBody', async () => {
    let seen: RequestInit | undefined
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      seen = init
      return jsonResponse(200, {
        reply_text: 'hello',
        handoff: false,
        conversation_id: 'conv_1',
      })
    })

    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: fetchFn as unknown as typeof fetch,
      nowSeconds: () => 1_793_100_000,
      sleep,
    })

    expect(result.ok).toBe(true)
    const headers = seen!.headers as Record<string, string>
    expect(headers['X-Astra-Timestamp']).toBe('1793100000')
    expect(headers['X-Astra-Signature']).toBe(
      buildAstraSignature(rawBody, SECRET, 1_793_100_000)
    )
    expect(seen!.body).toBe(rawBody)
  })

  it('retries once on 5xx with the same body (idempotent message_id)', async () => {
    const bodies: string[] = []
    const ordered = vi
      .fn()
      .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
        bodies.push(String(init?.body))
        return jsonResponse(502, { error: 'llm_failed' })
      })
      .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
        bodies.push(String(init?.body))
        return jsonResponse(200, {
          reply_text: 'ok',
          handoff: false,
          conversation_id: 'conv_1',
        })
      })

    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: ordered as unknown as typeof fetch,
      sleep,
    })

    expect(result.ok).toBe(true)
    expect(ordered).toHaveBeenCalledTimes(2)
    expect(bodies[0]).toBe(rawBody)
    expect(bodies[1]).toBe(rawBody)
    expect(JSON.parse(bodies[0]).message_id).toBe('wamid.SAME')
    expect(JSON.parse(bodies[1]).message_id).toBe('wamid.SAME')
  })

  it('retries once on network error with the same message_id', async () => {
    const ordered = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          reply_text: null,
          handoff: false,
          conversation_id: 'conv_1',
        })
      )

    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: ordered as unknown as typeof fetch,
      sleep,
    })

    expect(result.ok).toBe(true)
    expect(ordered).toHaveBeenCalledTimes(2)
  })

  it('on 429 waits Retry-After then resends the same body', async () => {
    const bodies: string[] = []
    const ordered = vi
      .fn()
      .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
        bodies.push(String(init?.body))
        return jsonResponse(
          429,
          { error: 'rate_limited' },
          { 'Retry-After': '3' }
        )
      })
      .mockImplementationOnce(async (_u: string, init?: RequestInit) => {
        bodies.push(String(init?.body))
        return jsonResponse(200, {
          reply_text: 'later',
          handoff: false,
          conversation_id: 'conv_1',
        })
      })

    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: ordered as unknown as typeof fetch,
      sleep,
    })

    expect(result.ok).toBe(true)
    expect(sleeps).toContain(3000)
    expect(bodies[0]).toBe(rawBody)
    expect(bodies[1]).toBe(rawBody)
  })

  it('does not retry ordinary 4xx', async () => {
    const ordered = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: 'bad_payload' }))

    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      fetchFn: ordered as unknown as typeof fetch,
      sleep,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('final_client_error')
    expect(ordered).toHaveBeenCalledTimes(1)
  })

  it('returns not_configured when env is missing', async () => {
    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: '',
      baseUrl: '',
      fetchFn: vi.fn() as unknown as typeof fetch,
      sleep,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_configured')
  })
})

/**
 * End-to-end contract tests against a mocked Astra Connect server.
 * Covers signature, payload shape, idempotent retry, 429, handoff,
 * /message posting, and media URL issuance.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { postSignedJson } from './client'
import { buildAstraSignature } from './sign'
import {
  buildSignedMediaUrl,
  verifyMediaToken,
  MEDIA_URL_TTL_SECONDS,
} from './media'

const SECRET = 'contract-test-secret-ok'
const PORT = 18765
const BASE = `http://127.0.0.1:${PORT}`

type Seen = {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  rawBody: string
}

const seen: Seen[] = []
let mode:
  | 'ok'
  | 'fail_once_502'
  | 'rate_limit_once'
  | 'echo' = 'ok'
let failBudget = 0

function verifyRequest(req: IncomingMessage, rawBody: string): string | null {
  const tsHeader = req.headers['x-astra-timestamp']
  const sigHeader = req.headers['x-astra-signature']
  if (typeof tsHeader !== 'string' || typeof sigHeader !== 'string') {
    return 'signature_required'
  }
  const ts = Number(tsHeader)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return 'stale_signature'
  }
  const expected = buildAstraSignature(rawBody, SECRET, ts)
  if (expected !== sigHeader.trim().toLowerCase()) {
    // Also accept exact match without lowercasing hex (already lower).
    const recomputed =
      'sha256=' +
      createHmac('sha256', SECRET).update(`${ts}.`).update(rawBody).digest('hex')
    if (recomputed !== sigHeader) return 'bad_signature'
  }
  return null
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const rawBody = await readBody(req)
  seen.push({
    method: req.method ?? '',
    url: req.url ?? '',
    headers: req.headers as Record<string, string | string[] | undefined>,
    rawBody,
  })

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
    return
  }

  const authErr = verifyRequest(req, rawBody)
  if (authErr) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: authErr }))
    return
  }

  if (mode === 'fail_once_502' && failBudget > 0) {
    failBudget -= 1
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'llm_failed' }))
    return
  }

  if (mode === 'rate_limit_once' && failBudget > 0) {
    failBudget -= 1
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': '0',
    })
    res.end(JSON.stringify({ error: 'rate_limited' }))
    return
  }

  const path = req.url ?? ''
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    res.writeHead(400)
    res.end(JSON.stringify({ error: 'bad_json' }))
    return
  }

  if (path === '/api/channels/whatsapp/inbound') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        reply_text: mode === 'echo' ? `echo:${body.text}` : 'Hi from Connect',
        handoff: false,
        conversation_id: 'conv_contract',
        duplicate: seen.filter((s) => s.url === path && s.rawBody === rawBody)
          .length > 1,
      })
    )
    return
  }

  if (path === '/api/channels/whatsapp/message') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        conversation_id: 'conv_contract',
        stored: true,
        handoff: false,
      })
    )
    return
  }

  if (path === '/api/channels/whatsapp/handoff') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        conversation_id: body.conversation_id ?? 'conv_contract',
        handoff: body.handoff === true,
      })
    )
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: 'not_found' }))
})

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve))
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  )
})

describe('Astra Connect contract (mocked server)', () => {
  it('inbound: signed payload shape + reply', async () => {
    mode = 'echo'
    seen.length = 0
    const payload = {
      tenant_id: 't_abc',
      phone_number_id: '106540352242922',
      customer_phone: '+919812345678',
      customer_name: 'Priya',
      message_id: 'wamid.CONTRACT1',
      timestamp: '2026-10-27T15:04:05Z',
      text: 'What is the price of the 3 kW kit?',
      media: [
        {
          type: 'audio',
          id: 'media_123',
          url: 'https://wa.astraconnect.io/media/abc?sig=1',
          mime_type: 'audio/ogg',
        },
      ],
    }
    const rawBody = JSON.stringify(payload)
    const result = await postSignedJson<{
      reply_text: string
      conversation_id: string
    }>({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      sleep: async () => undefined,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.reply_text).toBe(
        'echo:What is the price of the 3 kW kit?'
      )
      expect(result.data.conversation_id).toBe('conv_contract')
    }

    expect(seen).toHaveLength(1)
    expect(seen[0].headers['x-astra-timestamp']).toBeTruthy()
    expect(String(seen[0].headers['x-astra-signature'])).toMatch(
      /^sha256=[0-9a-f]{64}$/
    )
    expect(JSON.parse(seen[0].rawBody)).toMatchObject(payload)
  })

  it('idempotent retry: same message_id on 502 then success', async () => {
    mode = 'fail_once_502'
    failBudget = 1
    seen.length = 0
    const rawBody = JSON.stringify({
      tenant_id: 't_abc',
      phone_number_id: '106540352242922',
      customer_phone: '+919812345678',
      message_id: 'wamid.RETRY',
      timestamp: '2026-10-27T15:04:05Z',
      text: 'retry me',
    })

    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      sleep: async () => undefined,
    })

    expect(result.ok).toBe(true)
    expect(seen).toHaveLength(2)
    expect(JSON.parse(seen[0].rawBody).message_id).toBe('wamid.RETRY')
    expect(JSON.parse(seen[1].rawBody).message_id).toBe('wamid.RETRY')
    expect(seen[0].rawBody).toBe(seen[1].rawBody)
  })

  it('429: queues (waits) and resends same message_id', async () => {
    mode = 'rate_limit_once'
    failBudget = 1
    seen.length = 0
    const waits: number[] = []
    const rawBody = JSON.stringify({
      tenant_id: 't_abc',
      phone_number_id: '106540352242922',
      customer_phone: '+919812345678',
      message_id: 'wamid.RATE',
      timestamp: '2026-10-27T15:04:05Z',
      text: 'busy',
    })

    const result = await postSignedJson({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })

    expect(result.ok).toBe(true)
    expect(seen).toHaveLength(2)
    expect(waits.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(seen[0].rawBody).message_id).toBe('wamid.RATE')
  })

  it('handoff:false posts to /handoff', async () => {
    mode = 'ok'
    seen.length = 0
    const rawBody = JSON.stringify({
      tenant_id: 't_abc',
      conversation_id: 'conv_contract',
      handoff: false,
      by: 'agent@acme.com',
      reason: 'agent_closed',
    })
    const result = await postSignedJson<{ handoff: boolean }>({
      path: '/api/channels/whatsapp/handoff',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      sleep: async () => undefined,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.handoff).toBe(false)
    expect(seen[0].url).toBe('/api/channels/whatsapp/handoff')
  })

  it('/message posts human/template without AI reply', async () => {
    mode = 'ok'
    seen.length = 0
    const rawBody = JSON.stringify({
      tenant_id: 't_abc',
      phone_number_id: '106540352242922',
      customer_phone: '+919812345678',
      message_id: 'wamid.OUT',
      timestamp: '2026-10-27T15:10:00Z',
      author: 'template',
      template_name: 'visit_reminder',
      text: 'Hi Priya, reminder…',
      sent_by: 'agent@acme.com',
    })
    const result = await postSignedJson<{ stored: boolean }>({
      path: '/api/channels/whatsapp/message',
      rawBody,
      secret: SECRET,
      baseUrl: BASE,
      sleep: async () => undefined,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.stored).toBe(true)
    expect(JSON.parse(seen[0].rawBody).author).toBe('template')
  })

  it('media URL is https, signed, ~15 min TTL', () => {
    const now = Math.floor(Date.now() / 1000)
    const url = buildSignedMediaUrl({
      accountId: 'acct-1',
      mediaId: 'media_123',
      mimeType: 'audio/ogg',
      nowSeconds: now,
      origin: 'https://wa.astraconnect.io',
      secret: SECRET,
    })
    expect(url).toMatch(/^https:\/\//)
    const token = decodeURIComponent(url!.split('/').pop()!)
    const payload = verifyMediaToken(token, SECRET, now)
    expect(payload?.e).toBe(now + MEDIA_URL_TTL_SECONDS)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  applyEmployeeIdFilter,
  applyHandoffFilter,
  buildCollectionEtag,
  clampLimit,
  clampTakeoverReason,
  decodeCursor,
  encodeCursor,
  etagMatches,
  handoffStateFromRow,
  mapConversationRow,
  mapMessageRow,
  parseHandoffFilter,
  resolveMessagesBefore,
} from './read-api'
import {
  CONNECT_HANDOFF_RATE,
  CONNECT_READ_NOT_MODIFIED_COST,
  CONNECT_READ_RATE,
  connectSignedPayload,
  verifyConnectRequest,
} from './read-auth'
import { buildAstraSignature } from './sign'

describe('read-api helpers', () => {
  it('clamps limit to 1..100', () => {
    expect(clampLimit(null)).toBe(50)
    expect(clampLimit('0')).toBe(50)
    expect(clampLimit('3')).toBe(3)
    expect(clampLimit('999')).toBe(100)
  })

  it('round-trips cursors', () => {
    const c = encodeCursor({
      updatedAt: '2026-10-27T17:00:00.000Z',
      id: '11111111-1111-1111-1111-111111111111',
    })
    expect(decodeCursor(c)).toEqual({
      updatedAt: '2026-10-27T17:00:00.000Z',
      id: '11111111-1111-1111-1111-111111111111',
    })
    expect(decodeCursor('nope')).toBeNull()
  })

  it('derives handoff state from pause / assignee', () => {
    expect(handoffStateFromRow({})).toBe('ai')
    expect(handoffStateFromRow({ ai_autoreply_disabled: true })).toBe('human')
    expect(
      handoffStateFromRow({ assigned_agent_id: 'u1' }),
    ).toBe('human')
  })
})

describe('(a) collection ETag + If-None-Match', () => {
  it('builds etag from max timestamp and count', () => {
    expect(buildCollectionEtag('2026-10-27T17:00:00.000Z', 12)).toBe(
      '"2026-10-27T17:00:00.000Z:12"',
    )
    expect(buildCollectionEtag(null, 0)).toBe('"0:0"')
  })

  it('matches If-None-Match with optional W/ and quotes', () => {
    const etag = '"2026-10-27T17:00:00.000Z:3"'
    expect(etagMatches(etag, etag)).toBe(true)
    expect(etagMatches(`W/${etag}`, etag)).toBe(true)
    expect(etagMatches('2026-10-27T17:00:00.000Z:3', etag)).toBe(true)
    expect(etagMatches('"other:1"', etag)).toBe(false)
    expect(etagMatches(null, etag)).toBe(false)
  })
})

describe('(e) messages before cursor', () => {
  it('treats opaque next_cursor as a before keyset', () => {
    const c = encodeCursor({
      updatedAt: '2026-10-27T16:00:00.000Z',
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })
    expect(resolveMessagesBefore(c)).toEqual({
      kind: 'cursor',
      updatedAt: '2026-10-27T16:00:00.000Z',
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })
  })

  it('accepts ISO upper bounds', () => {
    expect(resolveMessagesBefore('2026-10-27T16:00:00.000Z')).toEqual({
      kind: 'iso',
      value: '2026-10-27T16:00:00.000Z',
    })
  })

  it('rejects garbage before values', () => {
    expect(resolveMessagesBefore('not-a-cursor')).toEqual({ kind: 'invalid' })
  })
})

describe('Connect request signing + X-Astra-Tenant (b)', () => {
  const secret = 'test-adapter-secret-16+'
  const tenant = 't_abc'

  it('GET signed payload is path-with-query.tenant', () => {
    const req = new Request(
      'https://chat.example/api/astra-connect/v1/conversations?tenant_id=t_abc&limit=10',
      { method: 'GET' },
    )
    expect(connectSignedPayload(req, '', tenant)).toBe(
      '/api/astra-connect/v1/conversations?tenant_id=t_abc&limit=10.t_abc',
    )
  })

  it('POST signed payload is rawBody.tenant', () => {
    const body = JSON.stringify({ tenant_id: 't1', by: 'x' })
    const req = new Request(
      'https://chat.example/api/astra-connect/v1/conversations/c1/takeover',
      { method: 'POST', body },
    )
    expect(connectSignedPayload(req, body, 't1')).toBe(`${body}.t1`)
  })

  it('accepts signatures over rawBody.tenant for POST', () => {
    const body = JSON.stringify({ tenant_id: 't_abc', by: 'ops' })
    const payload = `${body}.t_abc`
    const ts = 1_700_000_000
    const sig = buildAstraSignature(payload, secret, ts)
    expect(
      verifyConnectRequest({
        signature: sig,
        payload,
        timestamp: ts,
        secrets: [secret],
        nowSeconds: ts,
      }),
    ).toBe(true)
    // Signature over body alone must not verify against body.tenant.
    const bodyOnlySig = buildAstraSignature(body, secret, ts)
    expect(
      verifyConnectRequest({
        signature: bodyOnlySig,
        payload,
        timestamp: ts,
        secrets: [secret],
        nowSeconds: ts,
      }),
    ).toBe(false)
  })

  it('accepts signatures over path-with-query.tenant', () => {
    const payload =
      '/api/astra-connect/v1/conversations?tenant_id=t_abc&employee_id=emp_1.t_abc'
    const ts = 1_700_000_000
    const lower = buildAstraSignature(payload, secret, ts)
    const upper = `sha256=${lower.slice('sha256='.length).toUpperCase()}`
    expect(
      verifyConnectRequest({
        signature: lower,
        payload,
        timestamp: ts,
        secrets: [secret],
        nowSeconds: ts,
      }),
    ).toBe(true)
    expect(
      verifyConnectRequest({
        signature: upper,
        payload,
        timestamp: ts,
        secrets: [secret],
        nowSeconds: ts,
      }),
    ).toBe(true)
  })

  it('rejects signatures that omit the tenant suffix', () => {
    const pathOnly =
      '/api/astra-connect/v1/conversations?tenant_id=t_abc&employee_id=emp_1'
    const ts = 1_700_000_000
    const sig = buildAstraSignature(pathOnly, secret, ts)
    expect(
      verifyConnectRequest({
        signature: sig,
        payload: `${pathOnly}.${tenant}`,
        timestamp: ts,
        secrets: [secret],
        nowSeconds: ts,
      }),
    ).toBe(false)
  })
})

describe('(d) rate budgets', () => {
  it('exposes 600/min reads, 120/min handoff, 0.25 for 304', () => {
    expect(CONNECT_READ_RATE).toEqual({ limit: 600, windowMs: 60_000 })
    expect(CONNECT_HANDOFF_RATE).toEqual({ limit: 120, windowMs: 60_000 })
    expect(CONNECT_READ_NOT_MODIFIED_COST).toBe(0.25)
  })
})

describe('handoff + employee filters', () => {
  it('parses handoff=ai|human and rejects garbage', () => {
    expect(parseHandoffFilter(null)).toBeNull()
    expect(parseHandoffFilter('ai')).toBe('ai')
    expect(parseHandoffFilter('human')).toBe('human')
    expect(parseHandoffFilter('bot')).toEqual({ error: 'invalid_handoff' })
  })

  it('applies handoff filters before pagination', () => {
    const chain = {
      or: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
    }
    applyHandoffFilter(chain, 'ai')
    expect(chain.or).toHaveBeenCalledWith(
      'ai_autoreply_disabled.is.null,ai_autoreply_disabled.eq.false',
    )
    expect(chain.is).toHaveBeenCalledWith('assigned_agent_id', null)

    const human = { or: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis() }
    applyHandoffFilter(human, 'human')
    expect(human.or).toHaveBeenCalledWith(
      'ai_autoreply_disabled.eq.true,assigned_agent_id.not.is.null',
    )
  })

  it('employee_id filter matches COALESCE(conv, whatsapp_config) like the response field', () => {
    const fallback = 'emp_default'
    // Filter equals number default → include null astra_employee_id rows.
    const matchDefault = { or: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
    applyEmployeeIdFilter(matchDefault, 'emp_default', fallback)
    expect(matchDefault.or).toHaveBeenCalledWith(
      'astra_employee_id.eq.emp_default,astra_employee_id.is.null',
    )
    expect(matchDefault.eq).not.toHaveBeenCalled()

    // Filter for a different employee → only explicit column matches.
    const other = { or: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
    applyEmployeeIdFilter(other, 'emp_other', fallback)
    expect(other.eq).toHaveBeenCalledWith('astra_employee_id', 'emp_other')
    expect(other.or).not.toHaveBeenCalled()

    // Response field uses the same coalesce.
    const mapped = mapConversationRow(
      {
        id: '11111111-1111-1111-1111-111111111111',
        astra_employee_id: null,
        status: 'open',
        unread_count: 0,
        updated_at: '2026-10-27T17:00:00.000Z',
        contact: { phone: '+919812345678', name: 'Priya', opted_out: false },
      },
      {
        fallbackEmployeeId: fallback,
        tenantId: 't_abc',
        phoneNumberId: '1065',
      },
    )
    expect(mapped.employee_id).toBe('emp_default')
    expect(mapped.phone_number_id).toBe('1065')
  })
})

describe('takeover reason', () => {
  it('clamps reason to 500 chars', () => {
    expect(clampTakeoverReason(null)).toBeNull()
    expect(clampTakeoverReason('  VIP escalation  ')).toBe('VIP escalation')
    expect(clampTakeoverReason('x'.repeat(500))).toBe('x'.repeat(500))
    expect(clampTakeoverReason('x'.repeat(501))).toEqual({
      error: 'reason_too_long',
    })
  })
})

describe('message media object', () => {
  it('returns expanded media fields; transcript null without stored text', () => {
    const prevOrigin = process.env.NEXT_PUBLIC_SITE_URL
    const prevSecret = process.env.WACRM_ADAPTER_SECRET
    process.env.NEXT_PUBLIC_SITE_URL = 'https://chat.example'
    process.env.WACRM_ADAPTER_SECRET = 'test-adapter-secret-16+'
    try {
      const msg = mapMessageRow(
        {
          id: '33333333-3333-3333-3333-333333333333',
          sender_type: 'customer',
          content_type: 'audio',
          content_text: null,
          media_url:
            'https://cdn.example/storage/v1/object/public/chat-media/account-a/1700000000000-voice.ogg',
          media_type: 'audio/ogg',
          media_filename: null,
          media_size_bytes: 4096,
          media_duration_s: 12.5,
          media_transcript: null,
          message_id: 'wamid.AUDIO1',
          status: 'delivered',
          created_at: '2026-10-27T16:59:00.000Z',
          ai_generated: false,
        },
        'acct-a',
        't_abc',
      )
      expect(msg.media).toMatchObject({
        id: 'wamid.AUDIO1',
        filename: 'voice.ogg',
        mime: 'audio/ogg',
        mime_type: 'audio/ogg',
        size: 4096,
        duration_s: 12.5,
        transcript: null,
      })
      expect(msg.media?.url).toContain('/api/astra-connect/media/')
      expect(msg.media?.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    } finally {
      if (prevOrigin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
      else process.env.NEXT_PUBLIC_SITE_URL = prevOrigin
      if (prevSecret === undefined) delete process.env.WACRM_ADAPTER_SECRET
      else process.env.WACRM_ADAPTER_SECRET = prevSecret
    }
  })

  it('fills transcript from stored media_transcript when present', () => {
    const msg = mapMessageRow(
      {
        id: '44444444-4444-4444-4444-444444444444',
        sender_type: 'customer',
        content_type: 'audio',
        media_url: 'https://cdn.example/voice.ogg',
        media_type: 'audio/ogg',
        media_transcript: 'please call me back',
        message_id: 'wamid.AUDIO2',
        status: 'delivered',
        created_at: '2026-10-27T16:59:00.000Z',
      },
      'acct-a',
      't_abc',
    )
    expect(msg.media?.transcript).toBe('please call me back')
  })
})

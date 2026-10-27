import { describe, expect, it } from 'vitest'
import {
  buildCollectionEtag,
  clampLimit,
  decodeCursor,
  encodeCursor,
  etagMatches,
  handoffStateFromRow,
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

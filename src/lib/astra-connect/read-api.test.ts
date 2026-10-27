import { describe, expect, it } from 'vitest'
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  handoffStateFromRow,
} from './read-api'
import {
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

describe('Connect request signing (GET path+query)', () => {
  const secret = 'test-adapter-secret-16+'

  it('accepts valid lowercase and uppercase hex signatures', () => {
    const payload =
      '/api/astra-connect/v1/conversations?tenant_id=t_abc&employee_id=emp_1'
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

  it('rejects invalid and expired signatures', () => {
    const payload = '/api/astra-connect/v1/conversations?tenant_id=t_abc'
    const ts = 1_700_000_000
    const sig = buildAstraSignature(payload, secret, ts)
    expect(
      verifyConnectRequest({
        signature: sig,
        payload,
        timestamp: ts,
        secrets: ['wrong-secret-16chars'],
        nowSeconds: ts,
      }),
    ).toBe(false)
    expect(
      verifyConnectRequest({
        signature: sig,
        payload,
        timestamp: ts,
        secrets: [secret],
        nowSeconds: ts + 301,
      }),
    ).toBe(false)
  })

  it('builds GET signed payload from path and query', () => {
    const req = new Request(
      'https://chat.example/api/astra-connect/v1/conversations?tenant_id=t1&limit=10',
      { method: 'GET' },
    )
    expect(connectSignedPayload(req, '')).toBe(
      '/api/astra-connect/v1/conversations?tenant_id=t1&limit=10',
    )
  })

  it('builds POST signed payload from raw body', () => {
    const body = JSON.stringify({ tenant_id: 't1', by: 'x' })
    const req = new Request(
      'https://chat.example/api/astra-connect/v1/conversations/c1/takeover',
      { method: 'POST', body },
    )
    expect(connectSignedPayload(req, body)).toBe(body)
  })
})

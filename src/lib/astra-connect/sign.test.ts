import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  buildAstraSignature,
  verifyAstraSignature,
  astraAuthHeaders,
} from './sign'

const secret = 'test-adapter-secret-16+'
const body = JSON.stringify({
  tenant_id: 't_abc',
  phone_number_id: '106540352242922',
  customer_phone: '+919812345678',
  message_id: 'wamid.HBgMOTE5ODEy',
  timestamp: '2026-10-27T15:04:05Z',
  text: 'What is the price?',
})

describe('buildAstraSignature', () => {
  it('matches the contract HMAC over "<ts>.<rawBody>"', () => {
    const ts = 1_793_100_000
    const sig = buildAstraSignature(body, secret, ts)
    const expected =
      'sha256=' +
      createHmac('sha256', secret)
        .update(`${ts}.`)
        .update(body)
        .digest('hex')
    expect(sig).toBe(expected)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('is deterministic for the same inputs', () => {
    expect(buildAstraSignature(body, secret, 100)).toBe(
      buildAstraSignature(body, secret, 100)
    )
  })

  it('changes when the body bytes change (no re-serialize)', () => {
    const a = buildAstraSignature(body, secret, 100)
    const b = buildAstraSignature(body + ' ', secret, 100)
    expect(a).not.toBe(b)
  })
})

describe('verifyAstraSignature', () => {
  const ts = 1_793_100_000
  const sig = buildAstraSignature(body, secret, ts)

  it('accepts a valid in-tolerance signature', () => {
    expect(verifyAstraSignature(sig, body, secret, ts, ts + 10)).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verifyAstraSignature(sig, body + 'x', secret, ts, ts)).toBe(false)
  })

  it('rejects a wrong secret', () => {
    expect(
      verifyAstraSignature(sig, body, 'other-secret-16chars', ts, ts)
    ).toBe(false)
  })

  it('rejects a stale timestamp (>300s)', () => {
    expect(verifyAstraSignature(sig, body, secret, ts, ts + 301)).toBe(false)
  })

  it('rejects a missing sha256= prefix', () => {
    expect(
      verifyAstraSignature(sig.replace('sha256=', ''), body, secret, ts, ts)
    ).toBe(false)
  })

  it('accepts uppercase hex signatures (Connect accepts either case)', () => {
    const upper = sig.replace(
      /sha256=([0-9a-f]+)/,
      (_m, hex: string) => `sha256=${hex.toUpperCase()}`,
    )
    expect(upper).toMatch(/sha256=[0-9A-F]+/)
    expect(verifyAstraSignature(upper, body, secret, ts, ts)).toBe(true)
  })
})

describe('astraAuthHeaders', () => {
  it('emits X-Astra-Timestamp and X-Astra-Signature', () => {
    const headers = astraAuthHeaders(body, secret, 42)
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Astra-Timestamp']).toBe('42')
    expect(headers['X-Astra-Signature']).toBe(
      buildAstraSignature(body, secret, 42)
    )
  })
})

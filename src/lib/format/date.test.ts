import { describe, expect, it } from 'vitest'
import { formatAppDate, formatAppDateTime } from './date'

describe('formatAppDate', () => {
  it('uses a consistent medium date (en-US)', () => {
    expect(formatAppDate('2026-10-27T12:00:00.000Z', 'en-US')).toBe(
      'Oct 27, 2026',
    )
  })

  it('returns empty string for invalid input', () => {
    expect(formatAppDate('not-a-date')).toBe('')
  })
})

describe('formatAppDateTime', () => {
  it('includes time for en-US', () => {
    const out = formatAppDateTime('2026-10-27T15:04:00.000Z', 'en-US')
    expect(out).toMatch(/Oct 27, 2026/)
    expect(out.length).toBeGreaterThan('Oct 27, 2026'.length)
  })
})

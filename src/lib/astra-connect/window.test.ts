import { describe, it, expect } from 'vitest'
import { isWithinCustomerCareWindow } from './window'

describe('isWithinCustomerCareWindow', () => {
  const now = new Date('2026-10-27T15:00:00Z').getTime()

  it('is true for a message a few minutes ago', () => {
    expect(
      isWithinCustomerCareWindow('2026-10-27T14:50:00Z', now)
    ).toBe(true)
  })

  it('is false after 24 hours', () => {
    expect(
      isWithinCustomerCareWindow('2026-10-26T14:59:00Z', now)
    ).toBe(false)
  })

  it('is false for missing timestamps', () => {
    expect(isWithinCustomerCareWindow(null, now)).toBe(false)
  })
})

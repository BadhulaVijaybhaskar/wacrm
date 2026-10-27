import { describe, expect, it } from 'vitest'
import {
  aggregateBroadcastCountsFromStatuses,
  broadcastCountsWithinRecipientCap,
  broadcastRatePercent,
} from './broadcast-counts'

describe('broadcastRatePercent', () => {
  it('clamps to 100% when counts exceed recipients (bad seed / drift)', () => {
    expect(broadcastRatePercent(6, 5)).toBe(100)
    expect(broadcastRatePercent(120, 100)).toBe(100)
  })

  it('returns 0 for empty totals', () => {
    expect(broadcastRatePercent(3, 0)).toBe(0)
    expect(broadcastRatePercent(3, -1)).toBe(0)
  })

  it('rounds normal rates', () => {
    expect(broadcastRatePercent(1, 3)).toBe(33)
    expect(broadcastRatePercent(2, 5)).toBe(40)
    expect(broadcastRatePercent(5, 5)).toBe(100)
  })
})

describe('aggregateBroadcastCountsFromStatuses — send-path invariant', () => {
  it('delivered/read never exceed recipient count when starting from zero', () => {
    // Same shape the demo seed uses after the zero-count insert fix.
    const statuses = ['read', 'delivered', 'sent', 'sent', 'sent']
    const counts = aggregateBroadcastCountsFromStatuses(statuses)
    expect(counts.total_recipients).toBe(5)
    expect(counts.sent_count).toBe(5)
    expect(counts.delivered_count).toBe(2)
    expect(counts.read_count).toBe(1)
    expect(broadcastCountsWithinRecipientCap(counts)).toBe(true)
    expect(
      broadcastRatePercent(counts.delivered_count, counts.total_recipients),
    ).toBeLessThanOrEqual(100)
    expect(
      broadcastRatePercent(counts.read_count, counts.total_recipients),
    ).toBeLessThanOrEqual(100)
  })

  it('detects the double-count bug (hand-set counts + trigger bumps)', () => {
    const statuses = ['read', 'delivered', 'sent', 'sent', 'sent']
    const fromTrigger = aggregateBroadcastCountsFromStatuses(statuses)
    // Old seed pre-set delivered = n-1, read = n-2, then trigger added again.
    const doubleCounted = {
      total_recipients: statuses.length,
      sent_count: statuses.length + fromTrigger.sent_count,
      delivered_count:
        Math.max(0, statuses.length - 1) + fromTrigger.delivered_count,
      read_count: Math.max(0, statuses.length - 2) + fromTrigger.read_count,
    }
    expect(broadcastCountsWithinRecipientCap(doubleCounted)).toBe(false)
    expect(
      broadcastRatePercent(
        doubleCounted.delivered_count,
        doubleCounted.total_recipients,
      ),
    ).toBe(100)
  })
})

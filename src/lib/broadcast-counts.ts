/**
 * Broadcast delivery / read rate helpers.
 *
 * Counts on `broadcasts` are maintained by the incremental trigger in
 * migration 005 from `broadcast_recipients` status. The UI must never
 * show >100% even if a bad seed or drift temporarily over-counts.
 */

export type BroadcastCountSnapshot = {
  total_recipients: number
  sent_count: number
  delivered_count: number
  read_count: number
  replied_count?: number
  failed_count?: number
}

/**
 * Percent of `total`, clamped to 0..100 so a drifted row cannot render
 * "Delivery 120%".
 */
export function broadcastRatePercent(
  value: number,
  total: number,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0
  }
  const pct = Math.round((value / total) * 100)
  if (pct < 0) return 0
  if (pct > 100) return 100
  return pct
}

/**
 * Mirror of `_bcast_cols_for_status` / recompute semantics — used by
 * tests to prove the real send path (zero parent counts + trigger bumps)
 * never lets delivered/read exceed recipient count.
 */
export function aggregateBroadcastCountsFromStatuses(
  statuses: string[],
): BroadcastCountSnapshot {
  let sent = 0
  let delivered = 0
  let read = 0
  let replied = 0
  let failed = 0
  for (const status of statuses) {
    switch (status) {
      case 'sent':
        sent += 1
        break
      case 'delivered':
        sent += 1
        delivered += 1
        break
      case 'read':
        sent += 1
        delivered += 1
        read += 1
        break
      case 'replied':
        sent += 1
        delivered += 1
        read += 1
        replied += 1
        break
      case 'failed':
        failed += 1
        break
      default:
        break
    }
  }
  return {
    total_recipients: statuses.length,
    sent_count: sent,
    delivered_count: delivered,
    read_count: read,
    replied_count: replied,
    failed_count: failed,
  }
}

/** True when delivered/read/sent never exceed total_recipients. */
export function broadcastCountsWithinRecipientCap(
  counts: BroadcastCountSnapshot,
): boolean {
  const total = Math.max(0, counts.total_recipients)
  return (
    counts.sent_count <= total &&
    counts.delivered_count <= total &&
    counts.read_count <= total &&
    (counts.replied_count ?? 0) <= total &&
    (counts.failed_count ?? 0) <= total
  )
}

/**
 * WhatsApp usage metering + optional billing webhook.
 *
 * Counters live in `astra_usage_daily`. Every increment also emits a
 * signed POST to BILLING_WEBHOOK_URL when set (Astra HMAC headers).
 * When the URL is unset the emitter is a no-op.
 */

import { astraAuthHeaders } from '@/lib/astra-connect/sign'
import { postSignedJson } from '@/lib/astra-connect/client'

export type UsageKind =
  | 'inbound_message'
  | 'outbound_message'
  | 'template_send'
  | 'conversation'

export type UsageDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc?: (fn: string, args: Record<string, unknown>) => any
}

const COLUMN: Record<UsageKind, string> = {
  inbound_message: 'inbound_messages',
  outbound_message: 'outbound_messages',
  template_send: 'template_sends',
  conversation: 'conversations',
}

export function billingWebhookUrl(): string | null {
  const raw = process.env.BILLING_WEBHOOK_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

export function billingWebhookSecret(): string | null {
  const dedicated = process.env.BILLING_WEBHOOK_SECRET?.trim()
  if (dedicated && dedicated.length >= 16) return dedicated
  const fallback = process.env.WACRM_ADAPTER_SECRET?.trim()
  if (fallback && fallback.length >= 16) return fallback
  return null
}

export function utcDayString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export interface UsageEventPayload {
  type: 'whatsapp.usage'
  account_id: string
  kind: UsageKind
  quantity: number
  day: string
  occurred_at: string
}

export function buildUsageEventPayload(args: {
  accountId: string
  kind: UsageKind
  quantity?: number
  day?: string
  occurredAt?: string
}): UsageEventPayload {
  const quantity = args.quantity ?? 1
  return {
    type: 'whatsapp.usage',
    account_id: args.accountId,
    kind: args.kind,
    quantity,
    day: args.day ?? utcDayString(),
    occurred_at: args.occurredAt ?? new Date().toISOString(),
  }
}

/**
 * Best-effort signed POST to BILLING_WEBHOOK_URL. No-op when unset or
 * when no signing secret is available.
 */
export async function emitBillingUsageWebhook(
  payload: UsageEventPayload,
  options?: {
    fetchFn?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    nowSeconds?: () => number
  },
): Promise<void> {
  const url = billingWebhookUrl()
  const secret = billingWebhookSecret()
  if (!url || !secret) return

  const rawBody = JSON.stringify(payload)
  // Absolute URL — postSignedJson joins base+path; pass full URL via baseUrl
  // with path empty by using URL parse.
  let baseUrl = url
  let path = '/'
  try {
    const u = new URL(url)
    baseUrl = `${u.protocol}//${u.host}`
    path = `${u.pathname}${u.search}` || '/'
  } catch {
    return
  }

  await postSignedJson({
    path,
    rawBody,
    baseUrl,
    secret,
    fetchFn: options?.fetchFn,
    sleep: options?.sleep,
    nowSeconds: options?.nowSeconds,
    // Billing is best-effort — avoid long Retry-After sleeps.
    retryOnRateLimit: false,
    timeoutMs: 10_000,
  })
}

/**
 * Increment a daily usage counter and emit the billing webhook.
 * Never throws — metering must not break message delivery.
 */
export async function recordWhatsappUsage(args: {
  db: UsageDb
  accountId: string
  kind: UsageKind
  quantity?: number
  now?: Date
  emit?: typeof emitBillingUsageWebhook
}): Promise<void> {
  try {
    const quantity = args.quantity ?? 1
    if (!args.accountId || quantity <= 0) return
    const now = args.now ?? new Date()
    const day = utcDayString(now)
    const column = COLUMN[args.kind]

    // Read-modify-write upsert. Prefer a single SQL upsert via RPC when
    // available; fall back to select+update for unit tests / plain mocks.
    const { data: existing } = await args.db
      .from('astra_usage_daily')
      .select('account_id, day, inbound_messages, outbound_messages, template_sends, conversations')
      .eq('account_id', args.accountId)
      .eq('day', day)
      .maybeSingle()

    if (existing) {
      const nextValue = Number(existing[column] ?? 0) + quantity
      await args.db
        .from('astra_usage_daily')
        .update({
          [column]: nextValue,
          updated_at: now.toISOString(),
        })
        .eq('account_id', args.accountId)
        .eq('day', day)
    } else {
      await args.db.from('astra_usage_daily').insert({
        account_id: args.accountId,
        day,
        inbound_messages: args.kind === 'inbound_message' ? quantity : 0,
        outbound_messages: args.kind === 'outbound_message' ? quantity : 0,
        template_sends: args.kind === 'template_send' ? quantity : 0,
        conversations: args.kind === 'conversation' ? quantity : 0,
        updated_at: now.toISOString(),
      })
    }

    const payload = buildUsageEventPayload({
      accountId: args.accountId,
      kind: args.kind,
      quantity,
      day,
      occurredAt: now.toISOString(),
    })
    const emit = args.emit ?? emitBillingUsageWebhook
    void emit(payload).catch((err) =>
      console.error(
        '[astra-billing] webhook emit failed:',
        err instanceof Error ? err.message : err,
      ),
    )
  } catch (err) {
    console.error(
      '[astra-billing] recordWhatsappUsage failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

/** Headers helper exported for docs / external verifiers. */
export function billingAuthHeaders(
  rawBody: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  return astraAuthHeaders(rawBody, secret, timestampSeconds)
}

/**
 * Connect read + handoff business logic (CHAT-04b).
 *
 * All queries are scoped to the authenticated tenant's account_id.
 * Cross-tenant conversation ids return null → routes map to 404.
 */

import { toE164 } from './phone'
import {
  buildSignedMediaUrlWithExpiry,
  MEDIA_URL_TTL_SECONDS,
} from './media'
import { mediaFilename } from '@/lib/media/filename'
import type { ContentType } from '@/types'
import type { ConnectTenantContext } from './read-auth'

const MAX_LIMIT = 100
const MAX_TAKEOVER_REASON = 500

export function clampLimit(raw: string | null, fallback = 50): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(MAX_LIMIT, Math.floor(n))
}

export function encodeCursor(parts: {
  updatedAt: string
  id: string
}): string {
  return Buffer.from(
    JSON.stringify({ u: parts.updatedAt, i: parts.id }),
    'utf8',
  ).toString('base64url')
}

export function decodeCursor(
  raw: string | null,
): { updatedAt: string; id: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as { u?: string; i?: string }
    if (
      typeof parsed.u === 'string' &&
      typeof parsed.i === 'string' &&
      parsed.u &&
      parsed.i
    ) {
      return { updatedAt: parsed.u, id: parsed.i }
    }
  } catch {
    /* ignore */
  }
  return null
}

export type HandoffState = 'ai' | 'human'

export function handoffStateFromRow(row: {
  ai_autoreply_disabled?: boolean | null
  assigned_agent_id?: string | null
}): HandoffState {
  if (row.ai_autoreply_disabled || row.assigned_agent_id) return 'human'
  return 'ai'
}

export interface ConnectConversationItem {
  id: string
  /** Connect tenant that owns this conversation (CHAT-04b). */
  tenant_id: string
  astra_conversation_id: string | null
  employee_id: string | null
  /** WhatsApp phone_number_id for this tenant's number. */
  phone_number_id: string | null
  status: string
  handoff: HandoffState
  unread_count: number
  last_message_preview: string | null
  updated_at: string
  assignee: { id: string } | null
  labels: string[]
  contact: {
    phone: string | null
    name: string | null
    opted_out: boolean
  }
}

export type HandoffFilter = 'ai' | 'human'

/** Apply handoff=ai|human before pagination (same rules as response field). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyHandoffFilter(q: any, handoff?: HandoffFilter | null) {
  if (handoff === 'ai') {
    return q
      .or('ai_autoreply_disabled.is.null,ai_autoreply_disabled.eq.false')
      .is('assigned_agent_id', null)
  }
  if (handoff === 'human') {
    return q.or(
      'ai_autoreply_disabled.eq.true,assigned_agent_id.not.is.null',
    )
  }
  return q
}

/**
 * Filter by effective employee id:
 * COALESCE(conversations.astra_employee_id, whatsapp_config.astra_employee_id)
 * — the same value the response `employee_id` field shows.
 */
export function applyEmployeeIdFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  employeeId: string | null | undefined,
  fallbackEmployeeId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!employeeId) return q
  if (fallbackEmployeeId === employeeId) {
    // Rows with an explicit match OR null (coalesce → number default).
    return q.or(
      `astra_employee_id.eq.${employeeId},astra_employee_id.is.null`,
    )
  }
  return q.eq('astra_employee_id', employeeId)
}

export function parseHandoffFilter(
  raw: string | null | undefined,
): HandoffFilter | null | { error: 'invalid_handoff' } {
  if (raw == null || raw === '') return null
  if (raw === 'ai' || raw === 'human') return raw
  return { error: 'invalid_handoff' }
}

export function clampTakeoverReason(
  raw: unknown,
): string | null | { error: 'reason_too_long' } {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_TAKEOVER_REASON) return { error: 'reason_too_long' }
  return trimmed
}

export async function listConnectConversations(args: {
  ctx: ConnectTenantContext
  phoneNumberId?: string | null
  employeeId?: string | null
  handoff?: HandoffFilter | null
  status?: string | null
  updatedSince?: string | null
  cursor?: string | null
  limit?: number
}): Promise<{ items: ConnectConversationItem[]; next_cursor: string | null }> {
  const limit = Math.min(MAX_LIMIT, args.limit ?? 50)
  const cursor = decodeCursor(args.cursor ?? null)

  let q = args.ctx.db
    .from('conversations')
    .select(
      `
      id,
      status,
      unread_count,
      last_message_text,
      last_message_at,
      updated_at,
      assigned_agent_id,
      ai_autoreply_disabled,
      astra_conversation_id,
      astra_employee_id,
      contact:contacts(
        id,
        phone,
        name,
        opted_out,
        contact_tags(tags(name))
      )
    `,
    )
    .eq('account_id', args.ctx.accountId)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (args.status) q = q.eq('status', args.status)
  if (args.updatedSince) q = q.gte('updated_at', args.updatedSince)
  q = applyEmployeeIdFilter(q, args.employeeId, args.ctx.employeeId)
  q = applyHandoffFilter(q, args.handoff)
  if (cursor) {
    // Keyset: (updated_at, id) < cursor for descending order.
    q = q.or(
      `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`,
    )
  }

  // phone_number_id is account-scoped via whatsapp_config; when provided
  // and it doesn't match this tenant's number, return empty (not other tenants).
  if (
    args.phoneNumberId &&
    args.ctx.phoneNumberId &&
    args.phoneNumberId !== args.ctx.phoneNumberId
  ) {
    return { items: [], next_cursor: null }
  }

  const { data, error } = await q
  if (error) {
    console.error('[astra-connect read] list conversations:', error)
    throw new Error('Failed to list conversations')
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const page = rows.slice(0, limit)
  const items = page.map((row) =>
    mapConversationRow(row, {
      fallbackEmployeeId: args.ctx.employeeId,
      tenantId: args.ctx.tenantId,
      phoneNumberId: args.ctx.phoneNumberId,
    }),
  )
  const next =
    rows.length > limit
      ? encodeCursor({
          updatedAt: String(page[page.length - 1]!.updated_at),
          id: String(page[page.length - 1]!.id),
        })
      : null

  return { items, next_cursor: next }
}

/**
 * ETag for a conversation list under the same filters: max(updated_at) + count.
 * Returns a quoted strong ETag, e.g. `"2026-10-27T17:00:00.000Z:12"`.
 */
export async function conversationListEtag(args: {
  ctx: ConnectTenantContext
  phoneNumberId?: string | null
  employeeId?: string | null
  handoff?: HandoffFilter | null
  status?: string | null
  updatedSince?: string | null
}): Promise<string> {
  if (
    args.phoneNumberId &&
    args.ctx.phoneNumberId &&
    args.phoneNumberId !== args.ctx.phoneNumberId
  ) {
    return buildCollectionEtag(null, 0)
  }

  let q = args.ctx.db
    .from('conversations')
    .select('updated_at', { count: 'exact' })
    .eq('account_id', args.ctx.accountId)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (args.status) q = q.eq('status', args.status)
  if (args.updatedSince) q = q.gte('updated_at', args.updatedSince)
  q = applyEmployeeIdFilter(q, args.employeeId, args.ctx.employeeId)
  q = applyHandoffFilter(q, args.handoff)

  const { data, count, error } = await q
  if (error) {
    console.error('[astra-connect read] conversation etag:', error)
    return buildCollectionEtag(null, 0)
  }
  const maxUpdated =
    Array.isArray(data) && data[0] && typeof data[0].updated_at === 'string'
      ? data[0].updated_at
      : null
  return buildCollectionEtag(maxUpdated, count ?? 0)
}

export function buildCollectionEtag(
  maxTimestamp: string | null,
  count: number,
): string {
  return `"${maxTimestamp ?? '0'}:${count}"`
}

/** Compare If-None-Match to an ETag (strips W/ prefix and quotes). */
export function etagMatches(
  ifNoneMatch: string | null,
  etag: string,
): boolean {
  if (!ifNoneMatch) return false
  const normalize = (v: string) =>
    v
      .trim()
      .replace(/^W\//i, '')
      .replace(/^"|"$/g, '')
  const want = normalize(etag)
  return ifNoneMatch
    .split(',')
    .map((p) => normalize(p))
    .some((p) => p === '*' || p === want)
}

export function mapConversationRow(
  row: Record<string, unknown>,
  opts: {
    fallbackEmployeeId: string | null
    tenantId: string
    phoneNumberId: string | null
  },
): ConnectConversationItem {
  const contactRaw = row.contact as
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null
  const contact = Array.isArray(contactRaw) ? contactRaw[0] : contactRaw
  const tagRows = (contact?.contact_tags as
    | { tags?: { name?: string } | null }[]
    | undefined) ?? []
  const labels = tagRows
    .map((t) => t.tags?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)

  const employee =
    (typeof row.astra_employee_id === 'string' && row.astra_employee_id) ||
    opts.fallbackEmployeeId

  return {
    id: String(row.id),
    tenant_id: opts.tenantId,
    astra_conversation_id:
      typeof row.astra_conversation_id === 'string'
        ? row.astra_conversation_id
        : null,
    employee_id: employee,
    phone_number_id: opts.phoneNumberId,
    status: String(row.status ?? 'open'),
    handoff: handoffStateFromRow({
      ai_autoreply_disabled: Boolean(row.ai_autoreply_disabled),
      assigned_agent_id:
        typeof row.assigned_agent_id === 'string' ? row.assigned_agent_id : null,
    }),
    unread_count: Number(row.unread_count ?? 0),
    last_message_preview:
      typeof row.last_message_text === 'string' ? row.last_message_text : null,
    updated_at: String(row.updated_at ?? row.last_message_at ?? new Date(0).toISOString()),
    assignee:
      typeof row.assigned_agent_id === 'string'
        ? { id: row.assigned_agent_id }
        : null,
    labels,
    contact: {
      phone: toE164(
        typeof contact?.phone === 'string' ? contact.phone : null,
      ),
      name: typeof contact?.name === 'string' ? contact.name : null,
      opted_out: Boolean(contact?.opted_out),
    },
  }
}

const CONVERSATION_SELECT = `
  id,
  account_id,
  status,
  unread_count,
  last_message_text,
  last_message_at,
  updated_at,
  assigned_agent_id,
  ai_autoreply_disabled,
  astra_conversation_id,
  astra_employee_id,
  contact:contacts(
    id,
    phone,
    name,
    opted_out,
    contact_tags(tags(name))
  )
`

/** Load one conversation scoped to the tenant account, or null → 404. */
export async function getTenantConversation(
  ctx: ConnectTenantContext,
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await ctx.db
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .eq('id', conversationId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (error || !data) return null
  return data as Record<string, unknown>
}

/** Map a tenant-scoped conversation row to the list-item shape. */
export function toConnectConversationItem(
  row: Record<string, unknown>,
  ctx: ConnectTenantContext,
): ConnectConversationItem {
  return mapConversationRow(row, {
    fallbackEmployeeId: ctx.employeeId,
    tenantId: ctx.tenantId,
    phoneNumberId: ctx.phoneNumberId,
  })
}

export interface ConnectMediaObject {
  id: string
  filename: string
  url: string
  mime: string | null
  /** @deprecated Prefer `mime`. Kept for older Connect clients. */
  mime_type: string | null
  size: number | null
  expires_at: string
  duration_s: number | null
  transcript: string | null
}

export interface ConnectMessageItem {
  id: string
  /** Connect tenant that owns this message's conversation (CHAT-04b). */
  tenant_id: string
  direction: 'inbound' | 'outbound'
  type: string
  text: string | null
  media: ConnectMediaObject | null
  template_name: string | null
  status: string
  failure_reason: string | null
  sender: {
    kind: 'contact' | 'human' | 'ai'
    member_id?: string | null
  }
  created_at: string
  whatsapp_message_id: string | null
}

/**
 * Resolve the messages `before` param:
 * - opaque keyset cursor (preferred for older pages)
 * - or ISO-8601 upper bound on created_at
 */
export function resolveMessagesBefore(
  before: string | null | undefined,
):
  | { kind: 'cursor'; updatedAt: string; id: string }
  | { kind: 'iso'; value: string }
  | { kind: 'none' }
  | { kind: 'invalid' } {
  if (!before || !before.trim()) return { kind: 'none' }
  const trimmed = before.trim()
  const asCursor = decodeCursor(trimmed)
  if (asCursor) return { kind: 'cursor', ...asCursor }
  // Loose ISO check — require a parseable date with a year prefix.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) {
    return { kind: 'iso', value: trimmed }
  }
  return { kind: 'invalid' }
}

export async function listConnectMessages(args: {
  ctx: ConnectTenantContext
  conversationId: string
  cursor?: string | null
  limit?: number
  before?: string | null
  after?: string | null
}): Promise<
  | {
      conversation: ConnectConversationItem
      items: ConnectMessageItem[]
      next_cursor: string | null
    }
  | null
  | { error: 'invalid_before' }
> {
  const conv = await getTenantConversation(args.ctx, args.conversationId)
  if (!conv) return null

  const limit = Math.min(MAX_LIMIT, args.limit ?? 50)
  // Prefer explicit `before` cursor for older pages; `cursor` is an alias.
  const beforeResolved = resolveMessagesBefore(args.before)
  if (beforeResolved.kind === 'invalid') return { error: 'invalid_before' }
  const legacyCursor = decodeCursor(args.cursor ?? null)
  const keyset =
    beforeResolved.kind === 'cursor'
      ? beforeResolved
      : legacyCursor
        ? { updatedAt: legacyCursor.updatedAt, id: legacyCursor.id }
        : null

  let q = args.ctx.db
    .from('messages')
    .select(
      'id, sender_type, sender_id, content_type, content_text, media_url, media_type, media_filename, media_size_bytes, media_duration_s, media_transcript, template_name, status, error_title, error_details, message_id, created_at, ai_generated',
    )
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (beforeResolved.kind === 'iso') q = q.lt('created_at', beforeResolved.value)
  if (args.after) q = q.gt('created_at', args.after)
  if (keyset) {
    // Stable older-page keyset: (created_at, id) < cursor, newest first.
    q = q.or(
      `created_at.lt.${keyset.updatedAt},and(created_at.eq.${keyset.updatedAt},id.lt.${keyset.id})`,
    )
  }

  const { data, error } = await q
  if (error) {
    console.error('[astra-connect read] list messages:', error)
    throw new Error('Failed to list messages')
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const page = rows.slice(0, limit)
  const items = page.map((row) =>
    mapMessageRow(row, args.ctx.accountId, args.ctx.tenantId),
  )
  const next =
    rows.length > limit
      ? encodeCursor({
          updatedAt: String(page[page.length - 1]!.created_at),
          id: String(page[page.length - 1]!.id),
        })
      : null

  return {
    conversation: toConnectConversationItem(conv, args.ctx),
    items,
    next_cursor: next,
  }
}

/**
 * ETag for a message list: max(created_at) + count for the conversation.
 */
export async function messageListEtag(args: {
  ctx: ConnectTenantContext
  conversationId: string
  before?: string | null
  after?: string | null
}): Promise<string | null> {
  const conv = await getTenantConversation(args.ctx, args.conversationId)
  if (!conv) return null

  let q = args.ctx.db
    .from('messages')
    .select('created_at', { count: 'exact' })
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .limit(1)

  const beforeResolved = resolveMessagesBefore(args.before)
  if (beforeResolved.kind === 'iso') q = q.lt('created_at', beforeResolved.value)
  if (beforeResolved.kind === 'cursor') {
    q = q.or(
      `created_at.lt.${beforeResolved.updatedAt},and(created_at.eq.${beforeResolved.updatedAt},id.lt.${beforeResolved.id})`,
    )
  }
  if (args.after) q = q.gt('created_at', args.after)

  const { data, count, error } = await q
  if (error) {
    console.error('[astra-connect read] message etag:', error)
    return buildCollectionEtag(null, 0)
  }
  const maxCreated =
    Array.isArray(data) && data[0] && typeof data[0].created_at === 'string'
      ? data[0].created_at
      : null
  return buildCollectionEtag(maxCreated, count ?? 0)
}

export function mapMessageRow(
  row: Record<string, unknown>,
  accountId: string,
  tenantId: string,
): ConnectMessageItem {
  const senderType = String(row.sender_type ?? 'customer')
  const direction: 'inbound' | 'outbound' =
    senderType === 'customer' ? 'inbound' : 'outbound'

  let sender: ConnectMessageItem['sender']
  if (senderType === 'customer') {
    sender = { kind: 'contact' }
  } else if (row.ai_generated === true || senderType === 'bot') {
    sender = { kind: 'ai' }
  } else {
    sender = {
      kind: 'human',
      member_id: typeof row.sender_id === 'string' ? row.sender_id : null,
    }
  }

  let media: ConnectMessageItem['media'] = null
  if (typeof row.media_url === 'string' && row.media_url) {
    const mediaId =
      typeof row.message_id === 'string' && row.message_id
        ? row.message_id
        : String(row.id)
    const mime =
      typeof row.media_type === 'string' && row.media_type
        ? row.media_type
        : null
    const signed = buildSignedMediaUrlWithExpiry({
      accountId,
      mediaId,
      durableUrl: row.media_url,
      mimeType: mime ?? undefined,
    })
    const contentType = String(row.content_type ?? 'document') as ContentType
    const filename =
      (typeof row.media_filename === 'string' && row.media_filename.trim()) ||
      mediaFilename({
        content_type: contentType,
        content_text:
          typeof row.content_text === 'string' ? row.content_text : undefined,
        media_url: row.media_url,
        media_type: mime,
        created_at: String(row.created_at ?? new Date().toISOString()),
      })
    const sizeRaw = row.media_size_bytes
    const size =
      typeof sizeRaw === 'number' && Number.isFinite(sizeRaw)
        ? sizeRaw
        : typeof sizeRaw === 'string' && Number.isFinite(Number(sizeRaw))
          ? Number(sizeRaw)
          : null
    const durationRaw = row.media_duration_s
    const duration_s =
      typeof durationRaw === 'number' && Number.isFinite(durationRaw)
        ? durationRaw
        : typeof durationRaw === 'string' && Number.isFinite(Number(durationRaw))
          ? Number(durationRaw)
          : null
    const transcript =
      typeof row.media_transcript === 'string' && row.media_transcript.trim()
        ? row.media_transcript
        : null
    const expires_at =
      signed?.expires_at ??
      new Date(
        (Math.floor(Date.now() / 1000) + MEDIA_URL_TTL_SECONDS) * 1000,
      ).toISOString()
    media = {
      id: mediaId,
      filename,
      url: signed?.url ?? row.media_url,
      mime,
      mime_type: mime,
      size,
      expires_at,
      duration_s,
      transcript,
    }
  }

  let failure: string | null = null
  if (row.status === 'failed') {
    const title = typeof row.error_title === 'string' ? row.error_title : null
    const details =
      typeof row.error_details === 'string' ? row.error_details : null
    failure = title
      ? details
        ? `${title} — ${details}`
        : title
      : details
  }

  return {
    id: String(row.id),
    tenant_id: tenantId,
    direction,
    type: String(row.content_type ?? 'text'),
    text: typeof row.content_text === 'string' ? row.content_text : null,
    media,
    template_name:
      typeof row.template_name === 'string' ? row.template_name : null,
    status: String(row.status ?? 'sent'),
    failure_reason: failure,
    sender,
    created_at: String(row.created_at),
    whatsapp_message_id:
      typeof row.message_id === 'string' ? row.message_id : null,
  }
}

export async function recordHandoffAudit(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  accountId: string
  conversationId: string
  action: 'takeover' | 'handback'
  by?: string | null
  source?: 'api' | 'inbox' | 'adapter'
  reason?: string | null
}): Promise<void> {
  await args.db.from('astra_connect_handoff_audit').insert({
    account_id: args.accountId,
    conversation_id: args.conversationId,
    action: args.action,
    by_actor: args.by ?? null,
    source: args.source ?? 'api',
    reason: args.reason ?? null,
  })
}

/**
 * Idempotent takeover / handback. Returns the resulting handoff state.
 */
export async function setConversationHandoff(args: {
  ctx: ConnectTenantContext
  conversationId: string
  handoff: 'human' | 'ai'
  by?: string | null
  source?: 'api' | 'inbox' | 'adapter'
  reason?: string | null
}): Promise<{ handoff: HandoffState; changed: boolean } | null> {
  const conv = await getTenantConversation(args.ctx, args.conversationId)
  if (!conv) return null

  const current = handoffStateFromRow({
    ai_autoreply_disabled: Boolean(conv.ai_autoreply_disabled),
    assigned_agent_id:
      typeof conv.assigned_agent_id === 'string' ? conv.assigned_agent_id : null,
  })
  const target: HandoffState = args.handoff === 'human' ? 'human' : 'ai'

  if (current === target) {
    // Still record an audit row for idempotent Connect retries? Spec says
    // idempotent — skip write + skip duplicate audit when already in state.
    return { handoff: current, changed: false }
  }

  const update: Record<string, unknown> =
    target === 'human'
      ? {
          ai_autoreply_disabled: true,
          ai_handoff_summary:
            args.by
              ? `Taken over by ${args.by} via Astra Connect`
              : 'Taken over via Astra Connect',
        }
      : {
          ai_autoreply_disabled: false,
          assigned_agent_id: null,
          ai_reply_count: 0,
          ai_handoff_summary: null,
        }

  const { error } = await args.ctx.db
    .from('conversations')
    .update(update)
    .eq('id', args.conversationId)
    .eq('account_id', args.ctx.accountId)

  if (error) {
    console.error('[astra-connect read] handoff update:', error)
    throw new Error('Failed to update handoff')
  }

  await recordHandoffAudit({
    db: args.ctx.db,
    accountId: args.ctx.accountId,
    conversationId: args.conversationId,
    action: target === 'human' ? 'takeover' : 'handback',
    by: args.by,
    source: args.source ?? 'api',
    reason: args.reason ?? null,
  })

  return { handoff: target, changed: true }
}

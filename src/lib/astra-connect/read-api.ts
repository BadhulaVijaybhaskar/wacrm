/**
 * Connect read + handoff business logic (CHAT-04b).
 *
 * All queries are scoped to the authenticated tenant's account_id.
 * Cross-tenant conversation ids return null → routes map to 404.
 */

import { toE164 } from './phone'
import { buildSignedMediaUrl } from './media'
import type { ConnectTenantContext } from './read-auth'

const MAX_LIMIT = 100

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
  astra_conversation_id: string | null
  employee_id: string | null
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

export async function listConnectConversations(args: {
  ctx: ConnectTenantContext
  phoneNumberId?: string | null
  employeeId?: string | null
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
  if (args.employeeId) q = q.eq('astra_employee_id', args.employeeId)
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
  const items = page.map((row) => mapConversationRow(row, args.ctx.employeeId))
  const next =
    rows.length > limit
      ? encodeCursor({
          updatedAt: String(page[page.length - 1]!.updated_at),
          id: String(page[page.length - 1]!.id),
        })
      : null

  return { items, next_cursor: next }
}

function mapConversationRow(
  row: Record<string, unknown>,
  fallbackEmployeeId: string | null,
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
    fallbackEmployeeId

  return {
    id: String(row.id),
    astra_conversation_id:
      typeof row.astra_conversation_id === 'string'
        ? row.astra_conversation_id
        : null,
    employee_id: employee,
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

/** Load one conversation scoped to the tenant account, or null → 404. */
export async function getTenantConversation(
  ctx: ConnectTenantContext,
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await ctx.db
    .from('conversations')
    .select(
      'id, account_id, status, unread_count, last_message_text, updated_at, assigned_agent_id, ai_autoreply_disabled, astra_conversation_id, astra_employee_id',
    )
    .eq('id', conversationId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (error || !data) return null
  return data as Record<string, unknown>
}

export interface ConnectMessageItem {
  id: string
  direction: 'inbound' | 'outbound'
  type: string
  text: string | null
  media: { url: string; mime_type?: string | null } | null
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

export async function listConnectMessages(args: {
  ctx: ConnectTenantContext
  conversationId: string
  cursor?: string | null
  limit?: number
  before?: string | null
  after?: string | null
}): Promise<{ items: ConnectMessageItem[]; next_cursor: string | null } | null> {
  const conv = await getTenantConversation(args.ctx, args.conversationId)
  if (!conv) return null

  const limit = Math.min(MAX_LIMIT, args.limit ?? 50)
  const cursor = decodeCursor(args.cursor ?? null)

  let q = args.ctx.db
    .from('messages')
    .select(
      'id, sender_type, sender_id, content_type, content_text, media_url, media_type, template_name, status, error_title, error_details, message_id, created_at, ai_generated',
    )
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (args.before) q = q.lt('created_at', args.before)
  if (args.after) q = q.gt('created_at', args.after)
  if (cursor) {
    q = q.or(
      `created_at.lt.${cursor.updatedAt},and(created_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`,
    )
  }

  const { data, error } = await q
  if (error) {
    console.error('[astra-connect read] list messages:', error)
    throw new Error('Failed to list messages')
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  const page = rows.slice(0, limit)
  const items = page.map((row) => mapMessageRow(row, args.ctx.accountId))
  const next =
    rows.length > limit
      ? encodeCursor({
          updatedAt: String(page[page.length - 1]!.created_at),
          id: String(page[page.length - 1]!.id),
        })
      : null

  return { items, next_cursor: next }
}

function mapMessageRow(
  row: Record<string, unknown>,
  accountId: string,
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
    // Prefer short-lived signed URL when we have a Meta id-like path;
    // otherwise pass through durable mirrored https URLs.
    const signed = buildSignedMediaUrl({
      accountId,
      mediaId: typeof row.message_id === 'string' ? row.message_id : 'media',
      durableUrl: row.media_url,
      mimeType: typeof row.media_type === 'string' ? row.media_type : undefined,
    })
    media = {
      url: signed ?? row.media_url,
      mime_type: typeof row.media_type === 'string' ? row.media_type : null,
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
}): Promise<void> {
  await args.db.from('astra_connect_handoff_audit').insert({
    account_id: args.accountId,
    conversation_id: args.conversationId,
    action: args.action,
    by_actor: args.by ?? null,
    source: args.source ?? 'api',
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
  })

  return { handoff: target, changed: true }
}

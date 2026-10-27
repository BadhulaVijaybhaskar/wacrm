/**
 * Forward an inbound WhatsApp message to Astra Connect and act on the
 * reply (send reply_text, honour handoff, fail → human inbox).
 *
 * Invoked from the Meta webhook's `after()` block when the account has
 * the adapter enabled. Owns its try/catch and NEVER throws — a failing
 * Connect call must not affect the webhook's 200 to Meta.
 */

import { engineSendText } from '@/lib/flows/meta-send'
import { postSignedJson } from './client'
import {
  isAstraConnectActive,
  loadAstraConnectAccountConfig,
  resolveAccountAdapterSecret,
  type AdapterConfigDb,
} from './config'
import { buildInboundMediaRefs } from './media'
import { toE164 } from './phone'
import { isWithinCustomerCareWindow } from './window'
import type {
  AstraInboundRequest,
  AstraInboundResponse,
  AstraMediaRef,
} from './types'

/** Minimal admin client surface used by the dispatcher. */
export type InboundDispatchDb = AdapterConfigDb

export interface DispatchInboundToAstraArgs {
  db: InboundDispatchDb
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  /** Meta wamid — idempotency key on Connect. */
  messageId: string
  /** Meta message timestamp (unix seconds string) or ISO. */
  messageTimestamp: string
  text?: string | null
  customerPhone?: string | null
  customerName?: string | null
  /** Meta message type (text/image/audio/…). */
  messageType: string
  /** Meta media id when the inbound carries media. */
  mediaId?: string | null
  /** Durable mirrored URL or proxy path. */
  mediaUrl?: string | null
  mediaMimeType?: string | null
  mediaCaption?: string | null
  mediaFilename?: string | null
  /** Injectables for tests. */
  postFn?: typeof postSignedJson
  sendTextFn?: typeof engineSendText
  buildMediaFn?: typeof buildInboundMediaRefs
}

/**
 * Pause automation on this thread and leave it in the human inbox.
 * Reuses the same columns the built-in AI handoff path sets.
 */
async function handToHuman(
  db: InboundDispatchDb,
  conversationId: string,
  astraConversationId?: string | null,
  summary?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
  }
  if (summary) update.ai_handoff_summary = summary
  if (astraConversationId) update.astra_conversation_id = astraConversationId
  await db.from('conversations').update(update).eq('id', conversationId)
}

async function rememberAstraConversation(
  db: InboundDispatchDb,
  conversationId: string,
  astraConversationId: string | null | undefined,
  employeeId?: string | null,
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (astraConversationId) update.astra_conversation_id = astraConversationId
  if (typeof employeeId === 'string' && employeeId.trim()) {
    update.astra_employee_id = employeeId.trim()
  }
  if (Object.keys(update).length === 0) return
  await db.from('conversations').update(update).eq('id', conversationId)
}

export async function dispatchInboundToAstraConnect(
  args: DispatchInboundToAstraArgs
): Promise<void> {
  const post = args.postFn ?? postSignedJson
  const sendText = args.sendTextFn ?? engineSendText
  const buildMedia = args.buildMediaFn ?? buildInboundMediaRefs

  try {
    const account = await loadAstraConnectAccountConfig(
      args.db,
      args.accountId
    )
    if (!isAstraConnectActive(account) || !account) return

    // If a human already owns this thread, still forward the inbound
    // (Connect stores it and returns reply_text:null + handoff:true),
    // but we never send a reply while paused locally.
    const { data: conv } = await args.db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, astra_conversation_id')
      .eq('id', args.conversationId)
      .maybeSingle()

    const customerPhone = toE164(args.customerPhone)
    if (!customerPhone) {
      console.warn(
        '[astra-connect] inbound skipped: contact has no E.164 phone'
      )
      await handToHuman(
        args.db,
        args.conversationId,
        null,
        'Astra Connect adapter: customer has no phone number to route.'
      )
      return
    }

    const media: AstraMediaRef[] = buildMedia({
      accountId: args.accountId,
      messageType: args.messageType,
      mediaId: args.mediaId,
      durableUrl: args.mediaUrl,
      mimeType: args.mediaMimeType,
      caption: args.mediaCaption ?? args.text,
      filename: args.mediaFilename,
    })

    const text = (args.text ?? '').trim()
    if (!text && media.length === 0) {
      // Nothing Connect can act on (e.g. unsupported type).
      return
    }

    // Normalize Meta's unix-seconds timestamp to ISO 8601.
    let timestamp = args.messageTimestamp
    if (/^\d+$/.test(timestamp)) {
      const n = Number(timestamp)
      const ms = n < 1e12 ? n * 1000 : n
      timestamp = new Date(ms).toISOString()
    }

    const payload: AstraInboundRequest = {
      tenant_id: account.tenantId,
      phone_number_id: account.phoneNumberId,
      customer_phone: customerPhone,
      message_id: args.messageId,
      timestamp,
    }
    if (text) payload.text = text
    if (media.length > 0) payload.media = media
    if (args.customerName) payload.customer_name = args.customerName

    const rawBody = JSON.stringify(payload)
    const result = await post<AstraInboundResponse>({
      path: '/api/channels/whatsapp/inbound',
      rawBody,
      secret: resolveAccountAdapterSecret(account) ?? undefined,
    })

    if (!result.ok) {
      console.error(
        `[astra-connect] /inbound failed (${result.code}):`,
        result.message,
        result.status ?? ''
      )
      await handToHuman(
        args.db,
        args.conversationId,
        typeof conv?.astra_conversation_id === 'string'
          ? conv.astra_conversation_id
          : null,
        `Astra Connect adapter failed (${result.code}); handed to human.`
      )
      return
    }

    const data = result.data
    // Prefer employee_id from Connect; else fall back to the number default.
    const employeeFromConnect =
      typeof data.employee_id === 'string' && data.employee_id.trim()
        ? data.employee_id.trim()
        : null
    const employeeFallback =
      typeof account.employeeId === 'string' && account.employeeId
        ? account.employeeId
        : null
    await rememberAstraConversation(
      args.db,
      args.conversationId,
      data.conversation_id,
      employeeFromConnect ?? employeeFallback,
    )

    if (data.handoff) {
      await handToHuman(
        args.db,
        args.conversationId,
        data.conversation_id,
        'Astra Connect handed this conversation to a human.'
      )
    }

    // Local pause / human assignment → never send even if Connect replied.
    if (conv?.ai_autoreply_disabled || conv?.assigned_agent_id) {
      return
    }
    if (data.handoff) return

    const reply = data.reply_text?.trim()
    if (!reply) return

    // 24-hour window: inbound just arrived so we should be inside it;
    // still guard delayed retries.
    if (!isWithinCustomerCareWindow(timestamp)) {
      await handToHuman(
        args.db,
        args.conversationId,
        data.conversation_id,
        'Astra Connect reply skipped: WhatsApp 24-hour window closed. Send an approved template or reply manually.'
      )
      return
    }

    await sendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: reply,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[astra-connect] inbound dispatch failed:', err)
    try {
      await handToHuman(
        args.db,
        args.conversationId,
        null,
        'Astra Connect adapter error; handed to human.'
      )
    } catch (inner) {
      console.error('[astra-connect] handToHuman failed:', inner)
    }
  }
}

/**
 * Notify Astra Connect of human / template outbound messages so its
 * thread stays complete (POST /api/channels/whatsapp/message).
 *
 * Gated by CONNECT_MIRROR_OUTBOUND (default OFF). Chat now owns
 * WhatsApp storage; Connect reads threads from us instead of receiving
 * mirrored /message posts. Keep the code path for optional opt-in.
 *
 * Never throws — best-effort, logged. Does not change handoff state.
 */

import { postSignedJson } from './client'
import {
  isAstraConnectActive,
  loadAstraConnectAccountConfig,
  resolveAccountAdapterSecret,
  type AdapterConfigDb,
} from './config'
import { toE164 } from './phone'
import type { AstraMessageRequest, AstraMessageResponse } from './types'

/** Opt-in mirror of outbound sends to Connect /message. Default off. */
export function isConnectOutboundMirrorEnabled(): boolean {
  const raw = process.env.CONNECT_MIRROR_OUTBOUND?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export interface NotifyOutboundArgs {
  db: AdapterConfigDb
  accountId: string
  customerPhone: string | null | undefined
  messageId: string
  author: 'human' | 'template'
  text?: string | null
  templateName?: string | null
  sentBy?: string | null
  timestamp?: string
}

export async function notifyConnectOutbound(
  args: NotifyOutboundArgs
): Promise<void> {
  try {
    // Chat owns WhatsApp threads; mirroring is opt-in only.
    if (!isConnectOutboundMirrorEnabled()) return

    const account = await loadAstraConnectAccountConfig(args.db, args.accountId)
    if (!isAstraConnectActive(account) || !account) return

    const customerPhone = toE164(args.customerPhone)
    if (!customerPhone || !args.messageId) return

    const payload: AstraMessageRequest = {
      tenant_id: account.tenantId,
      phone_number_id: account.phoneNumberId,
      customer_phone: customerPhone,
      message_id: args.messageId,
      timestamp: args.timestamp ?? new Date().toISOString(),
      author: args.author,
    }
    if (args.text) payload.text = args.text
    if (args.templateName) payload.template_name = args.templateName
    if (args.sentBy) payload.sent_by = args.sentBy

    const rawBody = JSON.stringify(payload)
    const result = await postSignedJson<AstraMessageResponse>({
      path: '/api/channels/whatsapp/message',
      rawBody,
      secret: resolveAccountAdapterSecret(account) ?? undefined,
    })

    if (!result.ok) {
      console.warn(
        `[astra-connect] /message failed (${result.code}):`,
        result.message,
        result.status ?? ''
      )
      return
    }

    // Persist Connect's conversation id when returned.
    if (result.data.conversation_id) {
      // Soft dependency — conversations table update is best-effort and
      // needs a richer client than AdapterConfigDb. Callers that care
      // pass through inbound dispatch which already stores it.
    }
  } catch (err) {
    console.error(
      '[astra-connect] notifyOutbound threw:',
      err instanceof Error ? err.message : err
    )
  }
}

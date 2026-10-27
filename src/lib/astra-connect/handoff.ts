/**
 * Tell Astra Connect the human inbox has taken over or released a thread
 * (POST /api/channels/whatsapp/handoff).
 *
 * - handoff:true  — human owns the thread (Connect will not reply)
 * - handoff:false — agent closed/released; AI resumes on next inbound
 */

import { postSignedJson } from './client'
import {
  isAstraConnectActive,
  loadAstraConnectAccountConfig,
  type AdapterConfigDb,
} from './config'
import { toE164 } from './phone'
import type { AstraHandoffRequest, AstraHandoffResponse } from './types'

export interface NotifyHandoffArgs {
  db: AdapterConfigDb
  accountId: string
  handoff: boolean
  /** Preferred when known (from a prior inbound response). */
  astraConversationId?: string | null
  customerPhone?: string | null
  by?: string | null
  reason?: string | null
}

export async function notifyConnectHandoff(
  args: NotifyHandoffArgs
): Promise<AstraHandoffResponse | null> {
  try {
    const account = await loadAstraConnectAccountConfig(args.db, args.accountId)
    if (!isAstraConnectActive(account) || !account) return null

    const payload: AstraHandoffRequest = {
      tenant_id: account.tenantId,
      handoff: args.handoff,
    }

    if (args.astraConversationId) {
      payload.conversation_id = args.astraConversationId
    } else {
      payload.phone_number_id = account.phoneNumberId
      const phone = toE164(args.customerPhone)
      if (!phone) {
        console.warn(
          '[astra-connect] /handoff skipped: no conversation_id or customer_phone'
        )
        return null
      }
      payload.customer_phone = phone
    }

    if (args.by) payload.by = args.by
    if (args.reason) payload.reason = args.reason

    const rawBody = JSON.stringify(payload)
    const result = await postSignedJson<AstraHandoffResponse>({
      path: '/api/channels/whatsapp/handoff',
      rawBody,
    })

    if (!result.ok) {
      console.warn(
        `[astra-connect] /handoff failed (${result.code}):`,
        result.message,
        result.status ?? ''
      )
      return null
    }
    return result.data
  } catch (err) {
    console.error(
      '[astra-connect] notifyHandoff threw:',
      err instanceof Error ? err.message : err
    )
    return null
  }
}

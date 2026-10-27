/**
 * Astra Connect WhatsApp adapter contract (v2) types.
 * Source of truth: docs / uploads/wacrm-adapter-contract.md
 */

export type AstraMediaType =
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'

export interface AstraMediaRef {
  type: AstraMediaType
  id: string
  url: string
  mime_type?: string
  caption?: string
  filename?: string
}

/** Shared identity fields for every adapter POST. */
export interface AstraIdentityFields {
  tenant_id: string
  /** Preferred mapping key — Meta phone_number_id, digits only. */
  phone_number_id?: string
  employee_id?: string
  whatsapp_number?: string
  customer_phone: string
}

export interface AstraInboundRequest extends AstraIdentityFields {
  customer_name?: string
  message_id: string
  /** ISO 8601, unix seconds, or unix ms — we always send ISO 8601. */
  timestamp: string
  text?: string
  media?: AstraMediaRef[]
}

export interface AstraInboundResponse {
  reply_text: string | null
  handoff: boolean
  conversation_id: string | null
  /** Optional Connect employee that owns this thread. */
  employee_id?: string | null
  duplicate?: boolean
  reason?: string
}

export interface AstraMessageRequest extends AstraIdentityFields {
  message_id: string
  timestamp: string
  author: 'human' | 'template'
  text?: string
  template_name?: string
  sent_by?: string
  media?: AstraMediaRef[]
}

export interface AstraMessageResponse {
  conversation_id: string | null
  stored: boolean
  handoff?: boolean
  duplicate?: boolean
  reason?: string
}

export interface AstraHandoffRequest {
  tenant_id: string
  conversation_id?: string
  phone_number_id?: string
  employee_id?: string
  whatsapp_number?: string
  customer_phone?: string
  handoff: boolean
  by?: string
  reason?: string
}

export interface AstraHandoffResponse {
  conversation_id: string
  handoff: boolean
}

export type AstraAdapterErrorCode =
  | 'not_configured'
  | 'network_error'
  | 'timeout'
  | 'http_error'
  | 'rate_limited'
  | 'in_progress'
  | 'final_client_error'

export interface AstraAdapterFailure {
  ok: false
  code: AstraAdapterErrorCode
  status?: number
  body?: unknown
  retryAfterSeconds?: number
  message: string
}

export interface AstraAdapterSuccess<T> {
  ok: true
  status: number
  data: T
}

export type AstraAdapterResult<T> = AstraAdapterSuccess<T> | AstraAdapterFailure

import type { StoredAdapterSecrets } from './secrets'

/** Per-account adapter settings loaded from whatsapp_config. */
export interface AstraConnectAccountConfig {
  enabled: boolean
  tenantId: string
  phoneNumberId: string
  /** Display / fallback WhatsApp business number when known. */
  whatsappNumber?: string | null
  /** Optional Connect employee id bound to this WhatsApp number. */
  employeeId?: string | null
  /** Encrypted per-account HMAC secret (+ optional previous during rotation). */
  secrets?: StoredAdapterSecrets | null
}

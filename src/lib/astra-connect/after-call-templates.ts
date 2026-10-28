/**
 * Connect §16 — after-call WhatsApp send + APPROVED template list.
 *
 * Spec: Astraconnect docs/wacrm-adapter-contract.md @ 97b9948.
 *   §16.1 GET  /api/astra-connect/v1/whatsapp/templates
 *   §16.2 POST /api/astra-connect/v1/whatsapp/send
 *
 * Flag: WACRM_AFTER_CALL_TEMPLATES (default off → 404).
 * Dry-run: WHATSAPP_TEMPLATES_DRY_RUN / META_STUB → no Meta call;
 *   response is `{ ok: true, dry_run: true }` (no message_id).
 *
 * Signing: §16 cites §2 headers + X-Astra-Tenant. Chat verifies via
 * authenticateConnectRequest (`${rawBody}.${tenant}` for POST), which
 * matches Connect's wa-provider.sign(secret, ts, body, tenant).
 */

import { decrypt } from '@/lib/whatsapp/encryption'
import { isTemplatesDryRun } from '@/lib/whatsapp/templates-dry-run'
import {
  MetaApiError,
  sendTemplateMessage,
  sendTextMessage,
} from '@/lib/whatsapp/meta-api'
import { ChannelGateError } from '@/lib/astra-connect/channel-status'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { resolveTemplateRow } from '@/lib/whatsapp/template-body'
import {
  isWithinCustomerCareWindow,
} from '@/lib/astra-connect/window'
import type { MessageTemplate } from '@/types'

export const AFTER_CALL_SEND_KIND = 'whatsapp.after_call' as const

/** Legacy kind from the first draft — rejected with bad_kind. */
export const AFTER_CALL_SEND_KIND_LEGACY = 'whatsapp.template_send' as const

export type AfterCallDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export function isAfterCallTemplatesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.WACRM_AFTER_CALL_TEMPLATES?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export type AfterCallTemplatePayload = {
  name: string
  language: string
  variables: string[]
}

export type AfterCallSendBody = {
  kind: typeof AFTER_CALL_SEND_KIND
  send_id: string
  tenant_id: string
  employee_id: string
  call_id: string
  phone_number_id: string
  waba_id?: string | null
  to: string
  type: 'template' | 'text'
  template?: AfterCallTemplatePayload
  text?: string
}

/**
 * Idempotency-Key must be `after-call:<call_id>` or
 * `after-call:<call_id>:template` (one template retry after window_closed).
 */
export function parseAfterCallIdempotencyKey(
  header: string | null | undefined,
  callId: string,
):
  | { ok: true; key: string; isTemplateRetry: boolean }
  | { ok: false; error: string } {
  const raw = (header ?? '').trim()
  if (!raw) {
    return { ok: false, error: 'missing_idempotency_key' }
  }
  const expected = `after-call:${callId}`
  const expectedRetry = `after-call:${callId}:template`
  if (raw === expected) {
    return { ok: true, key: raw, isTemplateRetry: false }
  }
  if (raw === expectedRetry) {
    return { ok: true, key: raw, isTemplateRetry: true }
  }
  return { ok: false, error: 'bad_idempotency_key' }
}

export function parseAfterCallSendBody(
  raw: unknown,
):
  | { ok: true; body: AfterCallSendBody }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'bad_json' }
  }
  const o = raw as Record<string, unknown>

  if (o.kind !== AFTER_CALL_SEND_KIND) {
    return { ok: false, error: 'bad_kind' }
  }

  const send_id = typeof o.send_id === 'string' ? o.send_id.trim() : ''
  const tenant_id =
    typeof o.tenant_id === 'string' ? o.tenant_id.trim() : ''
  const employee_id =
    typeof o.employee_id === 'string' ? o.employee_id.trim() : ''
  const call_id = typeof o.call_id === 'string' ? o.call_id.trim() : ''
  const phone_number_id =
    typeof o.phone_number_id === 'string' ? o.phone_number_id.trim() : ''
  const to = typeof o.to === 'string' ? o.to.trim() : ''
  const type = o.type

  if (!send_id) return { ok: false, error: 'missing_send_id' }
  if (!tenant_id) return { ok: false, error: 'missing_tenant' }
  if (!employee_id) return { ok: false, error: 'missing_employee_id' }
  if (!call_id) return { ok: false, error: 'missing_call_id' }
  if (!phone_number_id) return { ok: false, error: 'missing_phone_number_id' }
  if (!/^\d+$/.test(phone_number_id)) {
    return { ok: false, error: 'bad_phone_number_id' }
  }
  if (!to) return { ok: false, error: 'missing_to' }
  const toDigits = normalizePhone(to)
  if (!toDigits || toDigits.length < 8) {
    return { ok: false, error: 'bad_to' }
  }

  let waba_id: string | null = null
  if (o.waba_id != null) {
    if (typeof o.waba_id !== 'string') {
      return { ok: false, error: 'bad_waba_id' }
    }
    waba_id = o.waba_id.trim() || null
  }

  if (type !== 'template' && type !== 'text') {
    return { ok: false, error: 'bad_type' }
  }

  if (type === 'template') {
    const tpl = o.template
    if (!tpl || typeof tpl !== 'object') {
      return { ok: false, error: 'missing_template' }
    }
    const t = tpl as Record<string, unknown>
    const name = typeof t.name === 'string' ? t.name.trim() : ''
    const language =
      typeof t.language === 'string' ? t.language.trim() : ''
    if (!name) return { ok: false, error: 'missing_template_name' }
    if (!language) return { ok: false, error: 'missing_template_language' }
    let variables: string[] = []
    if (t.variables != null) {
      if (
        !Array.isArray(t.variables) ||
        !t.variables.every((p) => typeof p === 'string')
      ) {
        return { ok: false, error: 'bad_template_variables' }
      }
      variables = t.variables as string[]
    }
    return {
      ok: true,
      body: {
        kind: AFTER_CALL_SEND_KIND,
        send_id,
        tenant_id,
        employee_id,
        call_id,
        phone_number_id,
        waba_id,
        to: toDigits,
        type: 'template',
        template: { name, language, variables },
      },
    }
  }

  const text = typeof o.text === 'string' ? o.text : ''
  if (!text.trim()) return { ok: false, error: 'missing_text' }

  return {
    ok: true,
    body: {
      kind: AFTER_CALL_SEND_KIND,
      send_id,
      tenant_id,
      employee_id,
      call_id,
      phone_number_id,
      waba_id,
      to: toDigits,
      type: 'text',
      text: text,
    },
  }
}

export type WhatsAppConfigRow = {
  id: string
  account_id: string
  phone_number_id: string
  access_token: string
  waba_id?: string | null
  status?: string | null
  astra_connect_tenant_id?: string | null
}

/**
 * Ensure the authenticated tenant owns `phone_number_id`.
 * Cross-tenant / unknown phone → 404 (do not leak existence).
 */
export async function loadTenantWhatsAppConfig(args: {
  db: AfterCallDb
  accountId: string
  tenantId: string
  phoneNumberId: string
}): Promise<
  | { ok: true; config: WhatsAppConfigRow }
  | { ok: false; status: 404 | 400; error: string }
> {
  const { data, error } = await args.db
    .from('whatsapp_config')
    .select(
      'id, account_id, phone_number_id, access_token, waba_id, status, astra_connect_tenant_id',
    )
    .eq('account_id', args.accountId)
    .maybeSingle()

  if (error) {
    console.error('[after-call] config load failed:', error)
    return { ok: false, status: 400, error: 'config_load_failed' }
  }

  if (!data?.phone_number_id || !data.access_token) {
    return { ok: false, status: 404, error: 'not_found' }
  }

  if (String(data.phone_number_id) !== args.phoneNumberId) {
    return { ok: false, status: 404, error: 'not_found' }
  }

  if (
    data.astra_connect_tenant_id &&
    String(data.astra_connect_tenant_id) !== args.tenantId
  ) {
    return { ok: false, status: 404, error: 'not_found' }
  }

  return {
    ok: true,
    config: {
      id: String(data.id),
      account_id: String(data.account_id),
      phone_number_id: String(data.phone_number_id),
      access_token: String(data.access_token),
      waba_id: data.waba_id ?? null,
      status: data.status ?? null,
      astra_connect_tenant_id: data.astra_connect_tenant_id ?? null,
    },
  }
}

/**
 * Last inbound (customer) message time for this contact on the account
 * that owns phone_number_id. Fail closed when unknown.
 */
export async function loadLastInboundAt(args: {
  db: AfterCallDb
  accountId: string
  toDigits: string
}): Promise<string | null> {
  const { data: contact, error: contactErr } = await args.db
    .from('contacts')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('phone_normalized', args.toDigits)
    .maybeSingle()

  if (contactErr || !contact?.id) return null

  const { data: conversation, error: convErr } = await args.db
    .from('conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', contact.id)
    .eq('channel', 'whatsapp')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (convErr || !conversation?.id) return null

  const { data: msg, error: msgErr } = await args.db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (msgErr || !msg?.created_at) return null
  return String(msg.created_at)
}

export type AfterCallStoredResult = {
  status_code: number
  response_body: Record<string, unknown>
  message_id: string | null
  dry_run: boolean
}

export async function readAfterCallIdempotent(args: {
  db: AfterCallDb
  accountId: string
  idempotencyKey: string
}): Promise<AfterCallStoredResult | null> {
  const { data, error } = await args.db
    .from('astra_after_call_sends')
    .select('status_code, response_body, message_id, dry_run')
    .eq('account_id', args.accountId)
    .eq('idempotency_key', args.idempotencyKey)
    .maybeSingle()

  if (error) {
    console.error('[after-call] idempotency read failed:', error)
    return null
  }
  if (!data) return null
  return {
    status_code: Number(data.status_code),
    response_body:
      data.response_body && typeof data.response_body === 'object'
        ? (data.response_body as Record<string, unknown>)
        : {},
    message_id: data.message_id != null ? String(data.message_id) : null,
    dry_run: Boolean(data.dry_run),
  }
}

export async function writeAfterCallIdempotent(args: {
  db: AfterCallDb
  accountId: string
  tenantId: string
  callId: string
  sendId: string
  idempotencyKey: string
  result: AfterCallStoredResult
}): Promise<void> {
  const { error } = await args.db.from('astra_after_call_sends').insert({
    account_id: args.accountId,
    idempotency_key: args.idempotencyKey,
    tenant_id: args.tenantId,
    call_id: args.callId,
    send_id: args.sendId,
    status_code: args.result.status_code,
    response_body: args.result.response_body,
    message_id: args.result.message_id,
    dry_run: args.result.dry_run,
  })
  if (error) {
    // Unique race: another instance wrote first — treat as success path
    // for the caller (they will re-read). Log other failures.
    const code = (error as { code?: string }).code
    if (code !== '23505') {
      console.error('[after-call] idempotency write failed:', error)
    }
  }
}

function mapMetaError(err: MetaApiError): {
  status: 400 | 422 | 429 | 502
  error: string
} {
  if (err.httpStatus === 429) {
    return { status: 429, error: 'rate_limited' }
  }
  // Meta template name / language miss
  if (
    err.code === 132001 ||
    err.code === 132000 ||
    /template/i.test(err.message) ||
    /template/i.test(err.details ?? '')
  ) {
    return { status: 422, error: 'template_not_found' }
  }
  if (err.httpStatus >= 400 && err.httpStatus < 500) {
    return { status: 400, error: 'bad_request' }
  }
  return { status: 502, error: 'upstream_error' }
}

export type AfterCallSendResult =
  | {
      ok: true
      status: 200
      body: { ok: true; message_id: string } | { ok: true; dry_run: true }
      replay: boolean
    }
  | {
      ok: false
      status: 400 | 403 | 404 | 409 | 422 | 429 | 502
      body: { error: string }
      replay?: boolean
      retry_after?: number
    }

export async function sendAfterCallMessage(args: {
  db: AfterCallDb
  accountId: string
  body: AfterCallSendBody
  idempotencyKey: string
  /** Inject for tests. */
  sendTemplateFn?: typeof sendTemplateMessage
  sendTextFn?: typeof sendTextMessage
  dryRun?: boolean
  now?: Date | number
}): Promise<AfterCallSendResult> {
  const prior = await readAfterCallIdempotent({
    db: args.db,
    accountId: args.accountId,
    idempotencyKey: args.idempotencyKey,
  })
  if (prior) {
    if (prior.status_code === 200) {
      return {
        ok: true,
        status: 200,
        body: prior.response_body as
          | { ok: true; message_id: string }
          | { ok: true; dry_run: true },
        replay: true,
      }
    }
    return {
      ok: false,
      status: prior.status_code as 400 | 403 | 404 | 409 | 422 | 429 | 502,
      body: { error: String(prior.response_body.error ?? 'failed') },
      replay: true,
    }
  }

  const cfg = await loadTenantWhatsAppConfig({
    db: args.db,
    accountId: args.accountId,
    tenantId: args.body.tenant_id,
    phoneNumberId: args.body.phone_number_id,
  })
  if (!cfg.ok) {
    const result: AfterCallStoredResult = {
      status_code: cfg.status,
      response_body: { error: cfg.error },
      message_id: null,
      dry_run: false,
    }
    // Do not durable-store 404/400 config misses as "first result" of a
    // successful send key — only store terminal send outcomes. Spec:
    // "treat a repeated key as the same send and answer with the first
    // result" — config miss is not a send. Return without writing.
    return {
      ok: false,
      status: cfg.status,
      body: { error: cfg.error },
    }
  }

  if (args.body.type === 'text') {
    const lastInbound = await loadLastInboundAt({
      db: args.db,
      accountId: args.accountId,
      toDigits: args.body.to,
    })
    if (!isWithinCustomerCareWindow(lastInbound, args.now)) {
      const stored: AfterCallStoredResult = {
        status_code: 409,
        response_body: { error: 'window_closed' },
        message_id: null,
        dry_run: false,
      }
      await writeAfterCallIdempotent({
        db: args.db,
        accountId: args.accountId,
        tenantId: args.body.tenant_id,
        callId: args.body.call_id,
        sendId: args.body.send_id,
        idempotencyKey: args.idempotencyKey,
        result: stored,
      })
      return {
        ok: false,
        status: 409,
        body: { error: 'window_closed' },
      }
    }
  }

  const dryRun = args.dryRun ?? isTemplatesDryRun()
  if (dryRun) {
    const stored: AfterCallStoredResult = {
      status_code: 200,
      response_body: { ok: true, dry_run: true },
      message_id: null,
      dry_run: true,
    }
    await writeAfterCallIdempotent({
      db: args.db,
      accountId: args.accountId,
      tenantId: args.body.tenant_id,
      callId: args.body.call_id,
      sendId: args.body.send_id,
      idempotencyKey: args.idempotencyKey,
      result: stored,
    })
    return {
      ok: true,
      status: 200,
      body: { ok: true, dry_run: true },
      replay: false,
    }
  }

  let accessToken: string
  try {
    accessToken = decrypt(cfg.config.access_token)
  } catch (err) {
    console.error(
      '[after-call] decrypt access_token failed:',
      err instanceof Error ? err.message : err,
    )
    return {
      ok: false,
      status: 400,
      body: { error: 'token_decrypt_failed' },
    }
  }

  try {
    let messageId: string
    if (args.body.type === 'text') {
      const sendFn = args.sendTextFn ?? sendTextMessage
      const result = await sendFn({
        phoneNumberId: cfg.config.phone_number_id,
        accessToken,
        to: args.body.to,
        text: args.body.text ?? '',
        accountId: args.accountId,
      })
      messageId = result.messageId
    } else {
      const tpl = args.body.template!
      // Local row is best-effort (components for Graph). Connect names
      // Meta as authority — incomplete/missing local rows still send.
      let templateRow: MessageTemplate | null = null
      let sendLanguage = tpl.language
      try {
        const resolved = await resolveTemplateRow(
          args.db as never,
          args.accountId,
          tpl.name,
          tpl.language || undefined,
        )
        if (!resolved.malformed) {
          templateRow = resolved.row
          sendLanguage = resolved.language || tpl.language
        }
      } catch {
        templateRow = null
      }

      if (templateRow && templateRow.status !== 'APPROVED') {
        return {
          ok: false,
          status: 422,
          body: { error: 'template_not_found' },
        }
      }

      const sendFn = args.sendTemplateFn ?? sendTemplateMessage
      const result = await sendFn({
        phoneNumberId: cfg.config.phone_number_id,
        accessToken,
        to: args.body.to,
        templateName: tpl.name,
        language: sendLanguage,
        template: templateRow ?? undefined,
        params: tpl.variables,
        accountId: args.accountId,
      })
      messageId = result.messageId
    }

    const body = { ok: true as const, message_id: messageId }
    await writeAfterCallIdempotent({
      db: args.db,
      accountId: args.accountId,
      tenantId: args.body.tenant_id,
      callId: args.body.call_id,
      sendId: args.body.send_id,
      idempotencyKey: args.idempotencyKey,
      result: {
        status_code: 200,
        response_body: body,
        message_id: messageId,
        dry_run: false,
      },
    })
    return { ok: true, status: 200, body, replay: false }
  } catch (err) {
    if (err instanceof ChannelGateError) {
      return {
        ok: false,
        status: 403,
        body: { error: 'auth_failed' },
      }
    }
    if (err instanceof MetaApiError) {
      const mapped = mapMetaError(err)
      const stored: AfterCallStoredResult = {
        status_code: mapped.status,
        response_body: { error: mapped.error },
        message_id: null,
        dry_run: false,
      }
      // Durable-store client/terminal Meta outcomes so retries with the
      // same key return the first result. 429/5xx are retried by Connect
      // with backoff — still store so a literal key replay is stable.
      await writeAfterCallIdempotent({
        db: args.db,
        accountId: args.accountId,
        tenantId: args.body.tenant_id,
        callId: args.body.call_id,
        sendId: args.body.send_id,
        idempotencyKey: args.idempotencyKey,
        result: stored,
      })
      return {
        ok: false,
        status: mapped.status,
        body: { error: mapped.error },
        retry_after: mapped.status === 429 ? 55 : undefined,
      }
    }
    const message = err instanceof Error ? err.message : 'Unknown Meta error'
    console.error('[after-call] send failed:', message)
    return {
      ok: false,
      status: 502,
      body: { error: 'upstream_error' },
    }
  }
}

/** @deprecated Use sendAfterCallMessage. Kept for older imports during rewrite. */
export const sendAfterCallTemplate = sendAfterCallMessage

export function countTemplateVariables(bodyText: string | null | undefined): number {
  if (!bodyText) return 0
  const matches = bodyText.match(/\{\{\d+\}\}/g)
  return matches ? matches.length : 0
}

export type ApprovedTemplateSummary = {
  name: string
  language: string
  status: 'APPROVED'
  category: string | null
  body_text: string | null
  variable_count: number
  meta_template_id?: string | null
  waba_id?: string | null
}

export type AfterCallListResult =
  | {
      ok: true
      templates: ApprovedTemplateSummary[]
      phone_number_id: string
      waba_id: string | null
    }
  | { ok: false; status: 400 | 404; error: string }

export async function listApprovedTemplates(args: {
  db: AfterCallDb
  accountId: string
  tenantId: string
  phoneNumberId: string
}): Promise<AfterCallListResult> {
  const cfg = await loadTenantWhatsAppConfig({
    db: args.db,
    accountId: args.accountId,
    tenantId: args.tenantId,
    phoneNumberId: args.phoneNumberId,
  })
  if (!cfg.ok) {
    return {
      ok: false,
      status: cfg.status,
      error: cfg.error,
    }
  }

  const { data, error } = await args.db
    .from('message_templates')
    .select(
      'name, language, category, status, body_text, meta_template_id',
    )
    .eq('account_id', args.accountId)
    .eq('status', 'APPROVED')
    .order('name', { ascending: true })

  if (error) {
    console.error('[after-call] template list failed:', error)
    return {
      ok: false,
      status: 400,
      error: 'template_list_failed',
    }
  }

  const templates: ApprovedTemplateSummary[] = (data ?? [])
    .filter((row: { status?: string }) => row.status === 'APPROVED')
    .map(
      (row: {
        name: string
        language: string
        category?: string | null
        body_text?: string | null
        meta_template_id?: string | null
      }) => ({
        name: String(row.name),
        language: String(row.language || 'en_US'),
        category: row.category ? String(row.category) : null,
        status: 'APPROVED' as const,
        body_text: row.body_text != null ? String(row.body_text) : null,
        variable_count: countTemplateVariables(
          row.body_text != null ? String(row.body_text) : null,
        ),
        meta_template_id:
          row.meta_template_id != null ? String(row.meta_template_id) : null,
        waba_id: cfg.config.waba_id ? String(cfg.config.waba_id) : null,
      }),
    )

  return {
    ok: true,
    templates,
    phone_number_id: cfg.config.phone_number_id,
    waba_id: cfg.config.waba_id ? String(cfg.config.waba_id) : null,
  }
}

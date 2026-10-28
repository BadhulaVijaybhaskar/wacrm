/**
 * Connect §16 — after-call WhatsApp template send + APPROVED list.
 *
 * Astraconnect `docs/wacrm-adapter-contract.md` §16 (PR #33 / feat/wa-after-call
 * @ 97b9948) was not readable from this environment. Paths and shapes below
 * follow the task brief + existing Chat Connect v1 conventions (§13 HMAC,
 * §15-style `/api/astra-connect/v1/whatsapp/…` layout). Adjust if Connect
 * ships different path names.
 *
 * Flag: WACRM_AFTER_CALL_TEMPLATES (default off → 404).
 * Dry-run: WHATSAPP_TEMPLATES_DRY_RUN / META_STUB → send skips Meta.
 */

import { randomUUID } from 'node:crypto'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isTemplatesDryRun } from '@/lib/whatsapp/templates-dry-run'
import {
  MetaApiError,
  sendTemplateMessage,
} from '@/lib/whatsapp/meta-api'
import { ChannelGateError } from '@/lib/astra-connect/channel-status'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { resolveTemplateRow } from '@/lib/whatsapp/template-body'
import type { MessageTemplate } from '@/types'

export const AFTER_CALL_SEND_KIND = 'whatsapp.template_send' as const

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

export type AfterCallSendBody = {
  kind: typeof AFTER_CALL_SEND_KIND
  tenant_id: string
  phone_number_id: string
  to: string
  template_name: string
  language?: string | null
  body_params?: string[]
  request_id: string
}

export function parseAfterCallSendBody(
  raw: unknown,
):
  | { ok: true; body: AfterCallSendBody }
  | { ok: false; error: string; code?: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'JSON body required', code: 'bad_json' }
  }
  const o = raw as Record<string, unknown>

  if (o.kind !== AFTER_CALL_SEND_KIND) {
    return {
      ok: false,
      error: `kind must be ${AFTER_CALL_SEND_KIND}`,
      code: 'bad_kind',
    }
  }

  const tenant_id =
    typeof o.tenant_id === 'string' ? o.tenant_id.trim() : ''
  const phone_number_id =
    typeof o.phone_number_id === 'string' ? o.phone_number_id.trim() : ''
  const to = typeof o.to === 'string' ? o.to.trim() : ''
  const template_name =
    typeof o.template_name === 'string' ? o.template_name.trim() : ''
  const request_id =
    typeof o.request_id === 'string' ? o.request_id.trim() : ''

  if (!tenant_id) {
    return { ok: false, error: 'tenant_id is required', code: 'missing_tenant' }
  }
  if (!phone_number_id) {
    return {
      ok: false,
      error: 'phone_number_id is required',
      code: 'missing_phone_number_id',
    }
  }
  if (!/^\d+$/.test(phone_number_id)) {
    return {
      ok: false,
      error: 'phone_number_id must contain only digits',
      code: 'bad_phone_number_id',
    }
  }
  if (!to) {
    return { ok: false, error: 'to is required', code: 'missing_to' }
  }
  const toDigits = normalizePhone(to)
  if (!toDigits || toDigits.length < 8) {
    return {
      ok: false,
      error: 'to must be a valid phone number',
      code: 'bad_to',
    }
  }
  if (!template_name) {
    return {
      ok: false,
      error: 'template_name is required',
      code: 'missing_template_name',
    }
  }
  if (!request_id) {
    return {
      ok: false,
      error: 'request_id is required',
      code: 'missing_request_id',
    }
  }

  let language: string | null = null
  if (o.language != null) {
    if (typeof o.language !== 'string') {
      return {
        ok: false,
        error: 'language must be a string',
        code: 'bad_language',
      }
    }
    language = o.language.trim() || null
  }

  let body_params: string[] | undefined
  if (o.body_params != null) {
    if (
      !Array.isArray(o.body_params) ||
      !o.body_params.every((p) => typeof p === 'string')
    ) {
      return {
        ok: false,
        error: 'body_params must be an array of strings',
        code: 'bad_body_params',
      }
    }
    body_params = o.body_params as string[]
  }

  return {
    ok: true,
    body: {
      kind: AFTER_CALL_SEND_KIND,
      tenant_id,
      phone_number_id,
      to: toDigits,
      template_name,
      language,
      body_params,
      request_id,
    },
  }
}

/** Process-local idempotency (draft). Keyed by tenant_id + request_id. */
const sendIdempotency = new Map<
  string,
  { message_id: string; dry_run: boolean; at: number }
>()

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export function clearAfterCallIdempotencyForTests(): void {
  sendIdempotency.clear()
}

function idempotencyKey(tenantId: string, requestId: string): string {
  return `${tenantId}\0${requestId}`
}

function readIdempotent(
  tenantId: string,
  requestId: string,
): { message_id: string; dry_run: boolean } | null {
  const key = idempotencyKey(tenantId, requestId)
  const hit = sendIdempotency.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > IDEMPOTENCY_TTL_MS) {
    sendIdempotency.delete(key)
    return null
  }
  return { message_id: hit.message_id, dry_run: hit.dry_run }
}

function writeIdempotent(
  tenantId: string,
  requestId: string,
  messageId: string,
  dryRun: boolean,
): void {
  sendIdempotency.set(idempotencyKey(tenantId, requestId), {
    message_id: messageId,
    dry_run: dryRun,
    at: Date.now(),
  })
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
  | { ok: false; status: 404 | 400; error: string; code?: string }
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
    return {
      ok: false,
      status: 400,
      error: 'Failed to load whatsapp_config',
      code: 'config_load_failed',
    }
  }

  if (!data?.phone_number_id || !data.access_token) {
    return { ok: false, status: 404, error: 'Not found', code: 'not_found' }
  }

  if (String(data.phone_number_id) !== args.phoneNumberId) {
    // Tenant asked for a phone_number_id that is not theirs.
    return {
      ok: false,
      status: 404,
      error: 'Not found',
      code: 'phone_number_id_mismatch',
    }
  }

  if (
    data.astra_connect_tenant_id &&
    String(data.astra_connect_tenant_id) !== args.tenantId
  ) {
    return { ok: false, status: 404, error: 'Not found', code: 'not_found' }
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

export type AfterCallSendResult =
  | {
      ok: true
      message_id: string
      request_id: string
      dry_run: boolean
      replay: boolean
    }
  | {
      ok: false
      status: 400 | 403 | 404 | 409 | 429 | 502
      error: string
      code?: string
      retry_after?: number
      meta?: { code?: number | null; subcode?: number | null }
    }

export async function sendAfterCallTemplate(args: {
  db: AfterCallDb
  accountId: string
  body: AfterCallSendBody
  /** Inject for tests — defaults to real Meta helper. */
  sendFn?: typeof sendTemplateMessage
  dryRun?: boolean
}): Promise<AfterCallSendResult> {
  const prior = readIdempotent(args.body.tenant_id, args.body.request_id)
  if (prior) {
    return {
      ok: true,
      message_id: prior.message_id,
      request_id: args.body.request_id,
      dry_run: prior.dry_run,
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
    return {
      ok: false,
      status: cfg.status,
      error: cfg.error,
      code: cfg.code,
    }
  }

  const dryRun = args.dryRun ?? isTemplatesDryRun()

  if (dryRun) {
    const messageId = `dry-run-${randomUUID()}`
    writeIdempotent(
      args.body.tenant_id,
      args.body.request_id,
      messageId,
      true,
    )
    return {
      ok: true,
      message_id: messageId,
      request_id: args.body.request_id,
      dry_run: true,
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
      error: 'Failed to decrypt WhatsApp access token',
      code: 'token_decrypt_failed',
    }
  }

  let templateRow: MessageTemplate | null = null
  let sendLanguage = args.body.language || 'en_US'
  const resolved = await resolveTemplateRow(
    // Query-builder duck-type matches SupabaseClient for this helper.
    args.db as never,
    args.accountId,
    args.body.template_name,
    args.body.language || undefined,
  )
  if (resolved.malformed) {
    return {
      ok: false,
      status: 400,
      error: 'Template row is malformed locally',
      code: 'template_malformed',
    }
  }
  templateRow = resolved.row
  sendLanguage = resolved.language

  if (templateRow && templateRow.status !== 'APPROVED') {
    return {
      ok: false,
      status: 400,
      error: `Template is not APPROVED (status=${templateRow.status})`,
      code: 'template_not_approved',
    }
  }

  const sendFn = args.sendFn ?? sendTemplateMessage
  try {
    const result = await sendFn({
      phoneNumberId: cfg.config.phone_number_id,
      accessToken,
      to: args.body.to,
      templateName: args.body.template_name,
      language: sendLanguage,
      template: templateRow ?? undefined,
      params: args.body.body_params,
      accountId: args.accountId,
    })
    const messageId = result.messageId || `wamid.unknown-${randomUUID()}`
    writeIdempotent(
      args.body.tenant_id,
      args.body.request_id,
      messageId,
      false,
    )
    return {
      ok: true,
      message_id: messageId,
      request_id: args.body.request_id,
      dry_run: false,
      replay: false,
    }
  } catch (err) {
    if (err instanceof ChannelGateError) {
      return {
        ok: false,
        status: 403,
        error: err.message,
        code: err.code,
      }
    }
    if (err instanceof MetaApiError) {
      if (err.httpStatus === 429) {
        return {
          ok: false,
          status: 429,
          error: err.message,
          code: 'meta_rate_limited',
          retry_after: 55,
          meta: { code: err.code, subcode: err.subcode },
        }
      }
      const status =
        err.httpStatus >= 400 && err.httpStatus < 500 ? 400 : 502
      return {
        ok: false,
        status,
        error: err.details || err.message,
        code: 'meta_error',
        meta: { code: err.code, subcode: err.subcode },
      }
    }
    const message = err instanceof Error ? err.message : 'Unknown Meta error'
    console.error('[after-call] send failed:', message)
    return {
      ok: false,
      status: 502,
      error: message,
      code: 'meta_error',
    }
  }
}

export type ApprovedTemplateSummary = {
  name: string
  language: string
  category: string | null
  status: 'APPROVED'
  body_text: string | null
  meta_template_id: string | null
  waba_id: string | null
}

export type AfterCallListResult =
  | { ok: true; templates: ApprovedTemplateSummary[]; phone_number_id: string; waba_id: string | null }
  | { ok: false; status: 400 | 404; error: string; code?: string }

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
      code: cfg.code,
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
      error: 'Failed to list templates',
      code: 'template_list_failed',
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

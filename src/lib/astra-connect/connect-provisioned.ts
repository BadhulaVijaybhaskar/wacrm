/**
 * Apply a Connect whatsapp.connect_provisioned event to local
 * whatsapp_config. Pure orchestration — the route owns HTTP/auth.
 *
 * - Decrypt access_token_enc (§15 HKDF+AES-GCM) then re-encrypt with
 *   the app ENCRYPTION_KEY (normal at-rest format).
 * - Idempotent on provision_id (astra_connect_provisions table).
 * - 409 when phone_number_id is already active for another tenant.
 * - Never calls Meta /register or /subscribed_apps.
 */

import { encrypt } from '@/lib/whatsapp/encryption'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  decryptProvisionedAccessToken,
  ProvisionCryptoError,
} from './provision-crypto'

/** Concurrent insert/update raced the UNIQUE(phone_number_id) index. */
function isPhoneNumberIdUniqueViolation(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false
  const e = error as { message?: string; details?: string; constraint?: string }
  const blob = `${e.constraint ?? ''} ${e.message ?? ''} ${e.details ?? ''}`.toLowerCase()
  return (
    blob.includes('phone_number_id') ||
    blob.includes('whatsapp_config_phone_number_id')
  )
}

export const CONNECT_PROVISIONED_KIND = 'whatsapp.connect_provisioned' as const

export type ConnectProvisionedBody = {
  kind: typeof CONNECT_PROVISIONED_KIND
  tenant_id: string
  phone_number_id: string
  provision_id: string
  access_token_enc: string
  waba_id?: string | null
  employee_id?: string | null
  display_phone_number?: string | null
}

export type ProvisionDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export type ApplyProvisionResult =
  | {
      ok: true
      config_id: string
      phone_number_id: string
      replay: boolean
    }
  | {
      ok: false
      status: 400 | 404 | 409
      error: string
      code?: string
    }

export function isConnectProvisionedEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.WACRM_CONNECT_PROVISIONED?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function parseConnectProvisionedBody(
  raw: unknown,
):
  | { ok: true; body: ConnectProvisionedBody }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'JSON body required' }
  }
  const o = raw as Record<string, unknown>

  if (o.kind !== CONNECT_PROVISIONED_KIND) {
    return {
      ok: false,
      error: `kind must be ${CONNECT_PROVISIONED_KIND}`,
    }
  }

  const tenant_id =
    typeof o.tenant_id === 'string' ? o.tenant_id.trim() : ''
  const phone_number_id =
    typeof o.phone_number_id === 'string' ? o.phone_number_id.trim() : ''
  const provision_id =
    typeof o.provision_id === 'string' ? o.provision_id.trim() : ''
  const access_token_enc =
    typeof o.access_token_enc === 'string' ? o.access_token_enc.trim() : ''

  if (!tenant_id) return { ok: false, error: 'tenant_id is required' }
  if (!phone_number_id) {
    return { ok: false, error: 'phone_number_id is required' }
  }
  if (!/^\d+$/.test(phone_number_id)) {
    return {
      ok: false,
      error: 'phone_number_id must contain only digits',
    }
  }
  if (!provision_id) return { ok: false, error: 'provision_id is required' }
  if (!access_token_enc) {
    return { ok: false, error: 'access_token_enc is required' }
  }

  const waba_id =
    o.waba_id == null
      ? null
      : typeof o.waba_id === 'string'
        ? o.waba_id.trim() || null
        : undefined
  if (waba_id === undefined) {
    return { ok: false, error: 'waba_id must be a string or null' }
  }

  const employee_id =
    o.employee_id == null
      ? null
      : typeof o.employee_id === 'string'
        ? o.employee_id.trim() || null
        : undefined
  if (employee_id === undefined) {
    return { ok: false, error: 'employee_id must be a string or null' }
  }

  const display_phone_number =
    o.display_phone_number == null
      ? null
      : typeof o.display_phone_number === 'string'
        ? o.display_phone_number.trim() || null
        : undefined
  if (display_phone_number === undefined) {
    return {
      ok: false,
      error: 'display_phone_number must be a string or null',
    }
  }

  return {
    ok: true,
    body: {
      kind: CONNECT_PROVISIONED_KIND,
      tenant_id,
      phone_number_id,
      provision_id,
      access_token_enc,
      waba_id,
      employee_id,
      display_phone_number,
    },
  }
}

export async function applyConnectProvisioned(args: {
  db: ProvisionDb
  accountId: string
  body: ConnectProvisionedBody
  adapterSecret: string
  /** accounts.owner_user_id — required when inserting a fresh config row. */
  ownerUserId: string
  now?: Date
}): Promise<ApplyProvisionResult> {
  const { db, accountId, body, adapterSecret, ownerUserId } = args
  const nowIso = (args.now ?? new Date()).toISOString()

  // Idempotent replay — same provision_id returns the prior config.
  const { data: prior, error: priorErr } = await db
    .from('astra_connect_provisions')
    .select('config_id, phone_number_id, account_id')
    .eq('provision_id', body.provision_id)
    .maybeSingle()

  if (priorErr) {
    console.error('[connect-provisioned] provision lookup failed:', priorErr)
    return { ok: false, status: 400, error: 'Failed to look up provision_id' }
  }

  if (prior?.config_id) {
    if (prior.account_id && prior.account_id !== accountId) {
      return {
        ok: false,
        status: 409,
        error: 'provision_id belongs to another tenant',
        code: 'provision_conflict',
      }
    }
    return {
      ok: true,
      config_id: String(prior.config_id),
      phone_number_id: String(prior.phone_number_id || body.phone_number_id),
      replay: true,
    }
  }

  // Phone claimed by a different tenant/account → 409.
  // whatsapp_config.phone_number_id is UNIQUE instance-wide; any other
  // row (connected or not) blocks the upsert.
  const { data: claimed, error: claimedErr } = await db
    .from('whatsapp_config')
    .select('id, account_id, astra_connect_tenant_id, status')
    .eq('phone_number_id', body.phone_number_id)
    .maybeSingle()

  if (claimedErr) {
    console.error('[connect-provisioned] phone claim check failed:', claimedErr)
    return {
      ok: false,
      status: 400,
      error: 'Failed to validate phone_number_id',
    }
  }

  if (
    claimed &&
    claimed.account_id &&
    String(claimed.account_id) !== accountId
  ) {
    return {
      ok: false,
      status: 409,
      error:
        'phone_number_id is already active for another tenant on this instance',
      code: 'phone_number_in_use',
    }
  }

  let plaintext: string
  try {
    plaintext = decryptProvisionedAccessToken({
      accessTokenEnc: body.access_token_enc,
      tenantId: body.tenant_id,
      phoneNumberId: body.phone_number_id,
      adapterSecret,
    })
  } catch (err) {
    if (err instanceof ProvisionCryptoError) {
      return {
        ok: false,
        status: 400,
        error: err.message,
        code: err.code,
      }
    }
    throw err
  }

  if (!plaintext.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'decrypted access token is empty',
      code: 'bad_ciphertext',
    }
  }

  let atRest: string
  try {
    atRest = encrypt(plaintext)
  } catch (err) {
    console.error(
      '[connect-provisioned] at-rest encrypt failed:',
      err instanceof Error ? err.message : err,
    )
    return {
      ok: false,
      status: 400,
      error: 'Failed to store access token (ENCRYPTION_KEY?)',
    }
  }

  // Upsert per (tenant → account, phone_number_id): prefer the row that
  // already owns this phone on this account; else the account's single
  // whatsapp_config (UNIQUE account_id).
  let existingId: string | null =
    claimed && String(claimed.account_id) === accountId
      ? String(claimed.id)
      : null

  if (!existingId) {
    const { data: existing, error: existingErr } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existingErr) {
      console.error('[connect-provisioned] config load failed:', existingErr)
      return { ok: false, status: 400, error: 'Failed to load whatsapp_config' }
    }
    if (existing?.id) existingId = String(existing.id)
  }

  const patch: Record<string, unknown> = {
    phone_number_id: body.phone_number_id,
    access_token: atRest,
    status: 'connected',
    connected_at: nowIso,
    updated_at: nowIso,
    astra_connect_enabled: true,
    astra_connect_tenant_id: body.tenant_id,
    // Connect already registered/subscribed — do not call Meta here.
    last_registration_error: null,
  }
  if (body.waba_id) patch.waba_id = body.waba_id
  if (body.employee_id) patch.astra_employee_id = body.employee_id

  let configId: string

  if (existingId) {
    const { data: updated, error: updErr } = await db
      .from('whatsapp_config')
      .update(patch)
      .eq('id', existingId)
      .select('id')
      .single()
    if (updErr || !updated?.id) {
      if (isPhoneNumberIdUniqueViolation(updErr)) {
        return {
          ok: false,
          status: 409,
          error:
            'phone_number_id is already active for another tenant on this instance',
          code: 'phone_number_in_use',
        }
      }
      console.error('[connect-provisioned] config update failed:', updErr)
      return { ok: false, status: 400, error: 'Failed to update whatsapp_config' }
    }
    configId = String(updated.id)
  } else {
    const { data: inserted, error: insErr } = await db
      .from('whatsapp_config')
      .insert({
        ...patch,
        account_id: accountId,
        user_id: ownerUserId,
        created_at: nowIso,
      })
      .select('id')
      .single()
    if (insErr || !inserted?.id) {
      if (isPhoneNumberIdUniqueViolation(insErr)) {
        return {
          ok: false,
          status: 409,
          error:
            'phone_number_id is already active for another tenant on this instance',
          code: 'phone_number_in_use',
        }
      }
      console.error('[connect-provisioned] config insert failed:', insErr)
      return { ok: false, status: 400, error: 'Failed to create whatsapp_config' }
    }
    configId = String(inserted.id)
  }

  const { error: provErr } = await db.from('astra_connect_provisions').insert({
    provision_id: body.provision_id,
    account_id: accountId,
    tenant_id: body.tenant_id,
    phone_number_id: body.phone_number_id,
    config_id: configId,
    created_at: nowIso,
  })

  if (provErr) {
    // Unique race: another concurrent request won — treat as replay.
    const { data: raced } = await db
      .from('astra_connect_provisions')
      .select('config_id, phone_number_id')
      .eq('provision_id', body.provision_id)
      .maybeSingle()
    if (raced?.config_id) {
      return {
        ok: true,
        config_id: String(raced.config_id),
        phone_number_id: String(raced.phone_number_id || body.phone_number_id),
        replay: true,
      }
    }
    console.error('[connect-provisioned] provision insert failed:', provErr)
    return {
      ok: false,
      status: 400,
      error: 'Failed to record provision_id',
    }
  }

  return {
    ok: true,
    config_id: configId,
    phone_number_id: body.phone_number_id,
    replay: false,
  }
}

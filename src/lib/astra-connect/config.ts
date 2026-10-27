/**
 * Adapter configuration: global env + per-account whatsapp_config flags.
 *
 * Enabled only when ALL of:
 *   - CONNECT_ADAPTER_URL is set
 *   - WACRM_ADAPTER_SECRET is set (≥16 chars, matching Connect)
 *   - whatsapp_config.astra_connect_enabled is true
 *   - whatsapp_config.astra_connect_tenant_id is non-empty
 */

import type { AstraConnectAccountConfig } from './types'
import {
  resolveAdapterSecrets,
  type StoredAdapterSecrets,
} from './secrets'

/** Base URL of Astra Connect (no trailing slash). */
export function connectAdapterBaseUrl(): string | null {
  const raw = process.env.CONNECT_ADAPTER_URL?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}

/**
 * Shared HMAC secret. Prefer an explicit per-account plaintext when
 * provided; otherwise the global `WACRM_ADAPTER_SECRET`.
 */
export function adapterSecret(accountSecret?: string | null): string | null {
  const perAccount = accountSecret?.trim()
  if (perAccount && perAccount.length >= 16) return perAccount
  const global = process.env.WACRM_ADAPTER_SECRET?.trim()
  if (global && global.length >= 16) return global
  return null
}

/**
 * Env is "configured" when CONNECT_ADAPTER_URL is set and *some* signing
 * secret is available globally. Per-account secrets alone are enough at
 * send time via {@link resolveAccountAdapterSecret}.
 */
export function isAdapterEnvConfigured(): boolean {
  return Boolean(connectAdapterBaseUrl() && adapterSecret())
}

/** Resolve the outbound signing secret for a loaded account config. */
export function resolveAccountAdapterSecret(
  account: AstraConnectAccountConfig | null | undefined,
): string | null {
  if (!account) return adapterSecret()
  return resolveAdapterSecrets(account.secrets).primary
}

/** Public site origin used for signed media URLs Connect will fetch. */
export function publicSiteOrigin(): string | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (site) return site.replace(/\/+$/, '')
  return null
}

/**
 * Minimal DB surface for the account-config loader.
 * Typed loosely so the real Supabase client (whose builders are
 * thenables, not plain Promises) assigns cleanly.
 */
export type AdapterConfigDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

/**
 * Load per-account adapter settings. Returns null when the account has
 * no whatsapp_config row (caller treats as disabled).
 */
export async function loadAstraConnectAccountConfig(
  db: AdapterConfigDb,
  accountId: string
): Promise<AstraConnectAccountConfig | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select(
      'phone_number_id, astra_connect_enabled, astra_connect_tenant_id, astra_connect_secret_encrypted, astra_connect_secret_previous_encrypted, astra_connect_secret_previous_expires_at',
    )
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[astra-connect] config load failed:', error.message)
    return null
  }
  if (!data) return null

  const tenantId =
    typeof data.astra_connect_tenant_id === 'string'
      ? data.astra_connect_tenant_id.trim()
      : ''

  const secrets: StoredAdapterSecrets = {
    currentEncrypted:
      typeof data.astra_connect_secret_encrypted === 'string'
        ? data.astra_connect_secret_encrypted
        : null,
    previousEncrypted:
      typeof data.astra_connect_secret_previous_encrypted === 'string'
        ? data.astra_connect_secret_previous_encrypted
        : null,
    previousExpiresAt:
      typeof data.astra_connect_secret_previous_expires_at === 'string'
        ? data.astra_connect_secret_previous_expires_at
        : null,
  }

  return {
    enabled: data.astra_connect_enabled === true,
    tenantId,
    phoneNumberId: String(data.phone_number_id ?? ''),
    whatsappNumber: null,
    secrets,
  }
}

/**
 * True when this account should route inbound through Astra Connect
 * (and skip built-in AI auto-reply).
 *
 * Requires CONNECT_ADAPTER_URL plus either a per-account secret or the
 * global WACRM_ADAPTER_SECRET.
 */
export function isAstraConnectActive(
  account: AstraConnectAccountConfig | null
): boolean {
  if (!account) return false
  if (!account.enabled) return false
  if (!account.tenantId) return false
  if (!account.phoneNumberId) return false
  if (!connectAdapterBaseUrl()) return false
  return Boolean(resolveAccountAdapterSecret(account))
}

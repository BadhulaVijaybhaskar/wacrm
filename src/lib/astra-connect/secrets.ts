/**
 * Per-account Astra Connect adapter HMAC secrets.
 *
 * Stored encrypted with ENCRYPTION_KEY (same GCM format as WhatsApp
 * tokens). Resolution order for signing outbound calls:
 *   1. current per-account secret (decrypted)
 *   2. global WACRM_ADAPTER_SECRET
 *
 * During rotation the previous secret remains valid for 24h so Connect
 * (or any verifier) can accept either until the new secret propagates.
 */

import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

export const SECRET_ROTATION_TTL_MS = 24 * 60 * 60 * 1000

function globalAdapterSecret(): string | null {
  const global = process.env.WACRM_ADAPTER_SECRET?.trim()
  if (global && global.length >= 16) return global
  return null
}

export interface StoredAdapterSecrets {
  currentEncrypted: string | null
  previousEncrypted: string | null
  previousExpiresAt: string | null
}

export interface ResolvedAdapterSecrets {
  /** Prefer this for outbound signing. */
  primary: string | null
  /** Secrets that should still verify (primary + previous-in-window + global). */
  accepted: string[]
}

function tryDecrypt(cipher: string | null | undefined): string | null {
  if (!cipher || typeof cipher !== 'string') return null
  try {
    const plain = decrypt(cipher).trim()
    return plain.length >= 16 ? plain : null
  } catch (err) {
    console.error(
      '[astra-connect] adapter secret decrypt failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

export function encryptAdapterSecret(plaintext: string): string {
  const trimmed = plaintext.trim()
  if (trimmed.length < 16) {
    throw new Error('Adapter secret must be at least 16 characters')
  }
  return encrypt(trimmed)
}

/**
 * Build the DB update payload for setting / rotating a per-account secret.
 * Passing `null` clears the current secret (and any previous).
 */
export function buildSecretRotationUpdate(
  nextPlaintext: string | null,
  existing: StoredAdapterSecrets,
  now: Date = new Date(),
): Record<string, unknown> {
  if (nextPlaintext === null) {
    return {
      astra_connect_secret_encrypted: null,
      astra_connect_secret_previous_encrypted: null,
      astra_connect_secret_previous_expires_at: null,
      updated_at: now.toISOString(),
    }
  }

  const nextCipher = encryptAdapterSecret(nextPlaintext)
  const update: Record<string, unknown> = {
    astra_connect_secret_encrypted: nextCipher,
    updated_at: now.toISOString(),
  }

  if (existing.currentEncrypted) {
    update.astra_connect_secret_previous_encrypted = existing.currentEncrypted
    update.astra_connect_secret_previous_expires_at = new Date(
      now.getTime() + SECRET_ROTATION_TTL_MS,
    ).toISOString()
  } else {
    update.astra_connect_secret_previous_encrypted = null
    update.astra_connect_secret_previous_expires_at = null
  }

  return update
}

export function resolveAdapterSecrets(
  stored: StoredAdapterSecrets | null | undefined,
  now: Date = new Date(),
): ResolvedAdapterSecrets {
  const current = tryDecrypt(stored?.currentEncrypted)
  const previousExpires = stored?.previousExpiresAt
    ? Date.parse(stored.previousExpiresAt)
    : NaN
  const previousStillValid =
    Number.isFinite(previousExpires) && previousExpires > now.getTime()
  const previous = previousStillValid
    ? tryDecrypt(stored?.previousEncrypted)
    : null
  const global = globalAdapterSecret()

  const accepted: string[] = []
  const pushUnique = (s: string | null) => {
    if (s && !accepted.includes(s)) accepted.push(s)
  }
  pushUnique(current)
  pushUnique(previous)
  pushUnique(global)

  return {
    primary: current ?? global,
    accepted,
  }
}

/** True when any accepted secret verifies the signature. */
export function verifyWithRotatedSecrets(
  verify: (secret: string) => boolean,
  stored: StoredAdapterSecrets | null | undefined,
  now: Date = new Date(),
): boolean {
  const { accepted } = resolveAdapterSecrets(stored, now)
  return accepted.some((secret) => verify(secret))
}

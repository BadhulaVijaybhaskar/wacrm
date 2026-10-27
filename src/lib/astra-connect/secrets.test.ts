import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildSecretRotationUpdate,
  encryptAdapterSecret,
  resolveAdapterSecrets,
  SECRET_ROTATION_TTL_MS,
  verifyWithRotatedSecrets,
} from './secrets'

const KEY =
  '0000000000000000000000000000000000000000000000000000000000000000'

describe('per-account adapter secrets', () => {
  const prevKey = process.env.ENCRYPTION_KEY
  const prevSecret = process.env.WACRM_ADAPTER_SECRET

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY
    process.env.WACRM_ADAPTER_SECRET = 'global-adapter-secret-16'
  })

  afterEach(() => {
    process.env.ENCRYPTION_KEY = prevKey
    process.env.WACRM_ADAPTER_SECRET = prevSecret
  })

  it('encrypts a secret and prefers it over the global fallback', () => {
    const cipher = encryptAdapterSecret('per-account-secret-16')
    const resolved = resolveAdapterSecrets({
      currentEncrypted: cipher,
      previousEncrypted: null,
      previousExpiresAt: null,
    })
    expect(resolved.primary).toBe('per-account-secret-16')
    expect(resolved.accepted).toContain('per-account-secret-16')
    expect(resolved.accepted).toContain('global-adapter-secret-16')
  })

  it('falls back to the global secret when none is stored', () => {
    const resolved = resolveAdapterSecrets(null)
    expect(resolved.primary).toBe('global-adapter-secret-16')
  })

  it('keeps the previous secret accepted for 24h after rotation', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    const oldCipher = encryptAdapterSecret('old-adapter-secret-16')
    const update = buildSecretRotationUpdate(
      'new-adapter-secret-16',
      {
        currentEncrypted: oldCipher,
        previousEncrypted: null,
        previousExpiresAt: null,
      },
      now,
    )

    expect(update.astra_connect_secret_previous_encrypted).toBe(oldCipher)
    const expires = Date.parse(
      String(update.astra_connect_secret_previous_expires_at),
    )
    expect(expires - now.getTime()).toBe(SECRET_ROTATION_TTL_MS)

    const midWindow = new Date(now.getTime() + 60_000)
    const resolved = resolveAdapterSecrets(
      {
        currentEncrypted: String(update.astra_connect_secret_encrypted),
        previousEncrypted: String(
          update.astra_connect_secret_previous_encrypted,
        ),
        previousExpiresAt: String(
          update.astra_connect_secret_previous_expires_at,
        ),
      },
      midWindow,
    )
    expect(resolved.primary).toBe('new-adapter-secret-16')
    expect(resolved.accepted).toEqual(
      expect.arrayContaining([
        'new-adapter-secret-16',
        'old-adapter-secret-16',
        'global-adapter-secret-16',
      ]),
    )

    expect(
      verifyWithRotatedSecrets(
        (s) => s === 'old-adapter-secret-16',
        {
          currentEncrypted: String(update.astra_connect_secret_encrypted),
          previousEncrypted: String(
            update.astra_connect_secret_previous_encrypted,
          ),
          previousExpiresAt: String(
            update.astra_connect_secret_previous_expires_at,
          ),
        },
        midWindow,
      ),
    ).toBe(true)

    const afterWindow = new Date(expires + 1)
    const expired = resolveAdapterSecrets(
      {
        currentEncrypted: String(update.astra_connect_secret_encrypted),
        previousEncrypted: String(
          update.astra_connect_secret_previous_encrypted,
        ),
        previousExpiresAt: String(
          update.astra_connect_secret_previous_expires_at,
        ),
      },
      afterWindow,
    )
    expect(expired.accepted).not.toContain('old-adapter-secret-16')
  })

  it('rejects secrets shorter than 16 characters', () => {
    expect(() => encryptAdapterSecret('too-short')).toThrow(/16/)
  })
})

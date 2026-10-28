/**
 * Connect → Chat provisioned-token crypto (§15).
 *
 * access_token_enc is AES-256-GCM. The key is:
 *   HKDF-SHA256(
 *     ikm  = WACRM_ADAPTER_SECRET,
 *     salt = "astra-connect",
 *     info = "wacrm-provision:access-token:v1",
 *     len  = 32,
 *   )
 * AAD is ASCII `"<tenant_id>.<phone_number_id>"`.
 *
 * Wire format (Connect encrypt / Chat decrypt):
 *   base64url( iv[12] || ciphertext || tag[16] )  — no padding.
 *
 * Astraconnect §15 was not readable from this environment; this matches
 * the summary in the task brief. Adjust here if Connect's PR #30–#32
 * ships a different packaging.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const PROVISION_HKDF_SALT = 'astra-connect'
export const PROVISION_HKDF_INFO = 'wacrm-provision:access-token:v1'
export const PROVISION_GCM_IV_LENGTH = 12
export const PROVISION_GCM_TAG_LENGTH = 16
export const PROVISION_KEY_LENGTH = 32

export class ProvisionCryptoError extends Error {
  readonly code: 'bad_ciphertext' | 'bad_aad' | 'missing_secret'
  constructor(code: ProvisionCryptoError['code'], message: string) {
    super(message)
    this.name = 'ProvisionCryptoError'
    this.code = code
  }
}

/** Derive the 32-byte AES key used for access_token_enc. */
export function deriveProvisionAccessTokenKey(adapterSecret: string): Buffer {
  const secret = adapterSecret.trim()
  if (!secret || secret.length < 16) {
    throw new ProvisionCryptoError(
      'missing_secret',
      'WACRM_ADAPTER_SECRET is required to decrypt provisioned tokens',
    )
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      PROVISION_HKDF_SALT,
      PROVISION_HKDF_INFO,
      PROVISION_KEY_LENGTH,
    ),
  )
}

export function provisionAad(
  tenantId: string,
  phoneNumberId: string,
): Buffer {
  return Buffer.from(`${tenantId}.${phoneNumberId}`, 'utf8')
}

/** base64url decode (Node Buffer accepts both padded and unpadded). */
export function decodeProvisionBlob(enc: string): Buffer {
  const trimmed = enc.trim()
  if (!trimmed) {
    throw new ProvisionCryptoError('bad_ciphertext', 'access_token_enc is empty')
  }
  // Normalize URL-safe alphabet → standard, restore padding.
  const b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  try {
    return Buffer.from(b64 + pad, 'base64')
  } catch {
    throw new ProvisionCryptoError(
      'bad_ciphertext',
      'access_token_enc is not valid base64url',
    )
  }
}

/**
 * Decrypt Connect's access_token_enc → plaintext Meta token.
 * Throws ProvisionCryptoError on tamper / wrong AAD / bad shape.
 */
export function decryptProvisionedAccessToken(args: {
  accessTokenEnc: string
  tenantId: string
  phoneNumberId: string
  adapterSecret: string
}): string {
  const key = deriveProvisionAccessTokenKey(args.adapterSecret)
  const blob = decodeProvisionBlob(args.accessTokenEnc)
  if (blob.length <= PROVISION_GCM_IV_LENGTH + PROVISION_GCM_TAG_LENGTH) {
    throw new ProvisionCryptoError(
      'bad_ciphertext',
      'access_token_enc is too short',
    )
  }

  const iv = blob.subarray(0, PROVISION_GCM_IV_LENGTH)
  const tag = blob.subarray(blob.length - PROVISION_GCM_TAG_LENGTH)
  const ciphertext = blob.subarray(
    PROVISION_GCM_IV_LENGTH,
    blob.length - PROVISION_GCM_TAG_LENGTH,
  )
  const aad = provisionAad(args.tenantId, args.phoneNumberId)

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return plain.toString('utf8')
  } catch {
    // GCM auth failure covers wrong key, tampered ciphertext, and wrong AAD.
    throw new ProvisionCryptoError(
      'bad_aad',
      'Failed to decrypt access_token_enc (tampered or wrong AAD)',
    )
  }
}

/**
 * Test / Connect-side helper: encrypt a plaintext token the same way
 * Chat expects to decrypt it. Kept here so cross-language vectors can
 * be checked against a single Node implementation.
 */
export function encryptProvisionedAccessToken(args: {
  plaintext: string
  tenantId: string
  phoneNumberId: string
  adapterSecret: string
  /** 12-byte IV — inject for deterministic vectors. */
  iv?: Buffer
}): { accessTokenEnc: string; iv: Buffer } {
  const key = deriveProvisionAccessTokenKey(args.adapterSecret)
  const iv = args.iv ?? randomBytes(PROVISION_GCM_IV_LENGTH)
  if (iv.length !== PROVISION_GCM_IV_LENGTH) {
    throw new Error(`iv must be ${PROVISION_GCM_IV_LENGTH} bytes`)
  }
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(provisionAad(args.tenantId, args.phoneNumberId))
  const ct = Buffer.concat([
    cipher.update(Buffer.from(args.plaintext, 'utf8')),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const blob = Buffer.concat([iv, ct, tag])
  const accessTokenEnc = blob
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return { accessTokenEnc, iv }
}

/** Stable hex fingerprint of the derived key — for vector tests only. */
export function provisionKeyFingerprint(adapterSecret: string): string {
  const key = deriveProvisionAccessTokenKey(adapterSecret)
  return createHmac('sha256', 'fingerprint').update(key).digest('hex')
}

/** timing-safe compare of two utf8 strings (tests). */
export function safeEqualUtf8(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

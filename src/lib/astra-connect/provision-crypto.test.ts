import { describe, expect, it } from 'vitest'
import {
  PROVISION_GCM_IV_LENGTH,
  PROVISION_HKDF_INFO,
  PROVISION_HKDF_SALT,
  decryptProvisionedAccessToken,
  deriveProvisionAccessTokenKey,
  encryptProvisionedAccessToken,
  provisionAad,
  provisionKeyFingerprint,
} from './provision-crypto'

const SECRET = 'test-adapter-secret-16chars'
const TENANT = 'tenant_abc'
const PHONE = '106540352242922'
const PLAIN = 'EAAG-test-meta-token-value'

/** Locked vectors — recompute only if the §15 HKDF params change. */
const FIXED_KEY_HEX =
  'ff5dc2ec3e20b3d533e0cb08ce54dfab26ae02c937f1489fc657aa39b8bc4f32'
const FIXED_KEY_FINGERPRINT =
  'cfca3142b4fbd20779f99d2375d1eb373135e1dfbb4acf22d5573b132f64cc7f'
const FIXED_IV = Buffer.alloc(PROVISION_GCM_IV_LENGTH, 0x11)
const FIXED_ACCESS_TOKEN_ENC =
  'ERERERERERERERERHurL7ss3DIcRXBrQfaedCh16mNsDqe2XO3EwoDmL2tpXrxnBt54p_KLa'

describe('provision HKDF + AES-GCM', () => {
  it('matches fixed HKDF key / fingerprint vectors', () => {
    expect(PROVISION_HKDF_SALT).toBe('astra-connect')
    expect(PROVISION_HKDF_INFO).toBe('wacrm-provision:access-token:v1')
    expect(provisionAad(TENANT, PHONE).toString('utf8')).toBe(
      `${TENANT}.${PHONE}`,
    )

    const key = deriveProvisionAccessTokenKey(SECRET)
    expect(key.toString('hex')).toBe(FIXED_KEY_HEX)
    expect(provisionKeyFingerprint(SECRET)).toBe(FIXED_KEY_FINGERPRINT)
  })

  it('decrypts a fixed IV ciphertext vector (cross-language check)', () => {
    const { accessTokenEnc } = encryptProvisionedAccessToken({
      plaintext: PLAIN,
      tenantId: TENANT,
      phoneNumberId: PHONE,
      adapterSecret: SECRET,
      iv: FIXED_IV,
    })
    expect(accessTokenEnc).toBe(FIXED_ACCESS_TOKEN_ENC)

    expect(
      decryptProvisionedAccessToken({
        accessTokenEnc: FIXED_ACCESS_TOKEN_ENC,
        tenantId: TENANT,
        phoneNumberId: PHONE,
        adapterSecret: SECRET,
      }),
    ).toBe(PLAIN)
  })

  it('rejects a tampered AAD (wrong phone_number_id)', () => {
    expect(() =>
      decryptProvisionedAccessToken({
        accessTokenEnc: FIXED_ACCESS_TOKEN_ENC,
        tenantId: TENANT,
        phoneNumberId: '999999999999999',
        adapterSecret: SECRET,
      }),
    ).toThrow(/tampered|AAD|decrypt/i)
  })

  it('rejects a tampered ciphertext blob', () => {
    const chars = FIXED_ACCESS_TOKEN_ENC.split('')
    const mid = Math.floor(chars.length / 2)
    chars[mid] = chars[mid] === 'A' ? 'B' : 'A'
    expect(() =>
      decryptProvisionedAccessToken({
        accessTokenEnc: chars.join(''),
        tenantId: TENANT,
        phoneNumberId: PHONE,
        adapterSecret: SECRET,
      }),
    ).toThrow(/tampered|AAD|decrypt|base64|short/i)
  })
})

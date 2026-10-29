import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptToken, encryptToken } from './crypto';
import { enabled, signupInput, publicError, SignupError } from './core';

describe('Embedded Signup cryptography', () => {
  const previous = process.env.WACRM_TOKEN_ENC_KEY;
  beforeEach(() => { process.env.WACRM_TOKEN_ENC_KEY = randomBytes(32).toString('base64'); });
  afterEach(() => { if(previous === undefined) delete process.env.WACRM_TOKEN_ENC_KEY; else process.env.WACRM_TOKEN_ENC_KEY=previous; });
  it('round-trips authenticated encrypted strings', () => {
    const sealed=encryptToken('secret-value');
    expect(sealed).not.toContain('secret-value');
    expect(decryptToken(sealed)).toBe('secret-value');
    expect(encryptToken('secret-value')).not.toBe(sealed);
  });
  it('rejects authenticated ciphertext tampering', () => {
    const raw=Buffer.from(encryptToken('secret'),'base64');raw[raw.length-1]^=1;
    expect(()=>decryptToken(raw.toString('base64'))).toThrow();
  });
  it('rejects invalid configuration',()=>{
    process.env.WACRM_TOKEN_ENC_KEY='invalid';
    expect(()=>encryptToken('value')).toThrow();
  });
});
describe('Embedded Signup request safety',()=>{
  it('defaults feature flag off',()=>{
    const was=process.env.WACRM_EMBEDDED_SIGNUP;
    delete process.env.WACRM_EMBEDDED_SIGNUP;
    expect(enabled()).toBe(false);
    if(was!==undefined)process.env.WACRM_EMBEDDED_SIGNUP=was;
  });
  it('rejects malformed inputs and unexpected fields',()=>{
    expect(signupInput.safeParse({code:'code',waba_id:'123',phone_number_id:'456'}).success).toBe(true);
    expect(signupInput.safeParse({code:'code',waba_id:'123x',phone_number_id:'456'}).success).toBe(false);
    expect(signupInput.safeParse({code:'code',waba_id:'123',phone_number_id:'456',token:'leak'}).success).toBe(false);
  });
  it('returns sanitized errors only',()=>{
    expect(publicError(new SignupError('asset_mismatch',403)).body).toEqual({
      error:'asset_mismatch',message:'WhatsApp connection could not be completed.',
    });
    expect(JSON.stringify(publicError(new Error('top-secret')))).not.toContain('top-secret');
  });
});

import { describe, expect, it } from 'vitest';
import { sanitizeLastError } from './errors';

describe('Embedded Signup last_error sanitizer',()=>{
  it('stores fixed reconnect instructions for removed partner access',()=>{
    expect(sanitizeLastError('partner_removed')).toBe('WhatsApp: Partner access removed. Reconnect WhatsApp.');
  });
  it('stores a numeric Meta code with an allowlisted safe message',()=>{
    expect(sanitizeLastError('meta_request_failed',100)).toBe('Meta 100: WhatsApp connection request failed.');
    expect(sanitizeLastError('pin_mismatch',133005)).toBe('Meta 133005: Two-step verification PIN is incorrect. Turn off two-step verification for this number in WhatsApp Manager, then retry.');
  });
  it('drops raw responses, tokens, codes, URLs, PINs and headers rather than trying to redact them',()=>{
    const raw='Authorization: Bearer private-token\r\nCookie: private-cookie https://graph.invalid?code=private-code pin=123456';
    for(const value of [raw,new Error(raw),{message:raw,response:{headers:{Authorization:raw}}},'__proto__','constructor','toString']){
      const message=sanitizeLastError(value,{message:raw});
      expect(message).toBe('WhatsApp: WhatsApp connection request failed.');
      for(const secret of ['private-token','private-cookie','private-code','123456','Authorization','Cookie','https://'])expect(message).not.toContain(secret);
      expect(message).not.toMatch(/[\r\n]/);expect(message.length).toBeLessThanOrEqual(300);
    }
  });
  it.each([undefined,null,'100',-1,Infinity,NaN,1.5,2147483648,{}, {toString:()=>{throw new Error('must not coerce');}}])('ignores invalid Meta code %j',code=>{
    expect(sanitizeLastError('meta_request_failed',code)).toBe('WhatsApp: WhatsApp connection request failed.');
  });
  it('keeps oversized attacker-controlled inputs out of a bounded message',()=>{
    const message=sanitizeLastError('private-token'.repeat(10000),'private-header'.repeat(10000));
    expect(message.length).toBeLessThanOrEqual(300);expect(message).not.toContain('private-');
  });
  it('uses a safe application message without fabricating a Meta code for DB failures',()=>{
    expect(sanitizeLastError('database_error')).toBe('WhatsApp: Connection state could not be saved.');
  });
});

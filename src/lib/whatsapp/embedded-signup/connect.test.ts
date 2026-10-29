import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { connect, publicError, SignupError } from './core';
import { decryptToken, encryptToken } from './crypto';

const h = vi.hoisted(() => ({
  owner: null as null | string,
  claimed: null as null | string,
  ownerStatus: 'connected', pinCiphertext: null as string | null,
  atomicPin: null as string | null, liveToken: '', writeFailure: false,
  pins: [] as string[],
  events: [] as string[],
  updates: [] as Record<string, unknown>[],
  claimError: false,
  mismatch: false,
  failure: '' as string,
  metaCode: 100,
}));
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: () => ({
  schema: (schema: string) => {
    expect(schema).toBe('wacrm');
    return {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => {
          h.events.push('ownership');
          return { data: h.owner ? { account_id: h.owner, status: h.ownerStatus, pin_ciphertext: h.pinCiphertext } : null, error: null };
        } }) }),
        update: (patch: Record<string, unknown>) => ({ eq: () => ({ eq: async () => {
          h.events.push(String(patch.status)); h.updates.push(patch);
          if(h.writeFailure) throw new Error('simulated write failure');
          if(typeof patch.token_ciphertext==='string') h.liveToken=patch.token_ciphertext;
          h.ownerStatus=String(patch.status);return { error: null };
        } }) }),
      }),
      rpc: async (_name: string, args: Record<string, string>) => {
        h.events.push('claim');
        if (h.claimError || (h.claimed && h.claimed !== args.p_account_id && h.ownerStatus !== 'disconnected'))
          return { data: null, error: { code: '23505', message: 'wa_connection_owned' } };
        const wasConnected=h.owner===args.p_account_id && h.ownerStatus==='connected';
        h.claimed = args.p_account_id;
        if(!wasConnected){h.ownerStatus='pending';h.liveToken=args.p_token_ciphertext;}
        h.pinCiphertext=h.atomicPin || h.pinCiphertext || args.p_pin_ciphertext;
        expect(decryptToken(args.p_token_ciphertext)).toBe('test-business-token');
        expect(decryptToken(args.p_pin_ciphertext)).toMatch(/^\d{6}$/);
        return { data: [{ id: 'connection-id', waba_id: args.p_waba_id, status: wasConnected?'connected':'pending',
          claimed_pin_ciphertext:h.pinCiphertext,previous_token_ciphertext:h.liveToken,
          display_phone_number: '+123', verified_name: 'Test', quality_rating: 'GREEN',
          token_ciphertext: args.p_token_ciphertext, pin_ciphertext: args.p_pin_ciphertext }], error: null };
      },
    };
  },
}) }));
const input = { code: 'test-oauth-code', waba_id: '123', phone_number_id: '456' };

beforeEach(() => {
  vi.stubEnv('META_APP_ID', 'test-app'); vi.stubEnv('META_APP_SECRET', 'test-secret');
  vi.stubEnv('WACRM_TOKEN_ENC_KEY', Buffer.alloc(32, 1).toString('base64'));
  h.owner = null; h.claimed = null; h.events = []; h.updates = []; h.claimError = false;
  h.mismatch = false; h.failure = ''; h.metaCode = 100;
  h.ownerStatus='connected';h.pinCiphertext=null;h.atomicPin=null;h.liveToken='';h.writeFailure=false;h.pins=[];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const step = url.includes('oauth/access_token') ? 'exchange' : url.includes('/phone_numbers') ? 'verify'
      : url.includes('/register') ? 'register' : url.includes('/subscribed_apps') ? 'subscribe' : 'phone';
    h.events.push(step);
    if(step==='register')h.pins.push(JSON.parse(String(options?.body)).pin);
    if (h.failure === step) return Response.json({ error: { code: h.metaCode, message: 'test-business-token test-oauth-code' } }, { status: 400 });
    return Response.json(step === 'exchange' ? { access_token: 'test-business-token' }
      : step === 'verify' ? { data: [{ id: h.mismatch ? '999' : '456' }] }
      : step === 'phone' ? { display_phone_number: '+123', verified_name: 'Test', quality_rating: 'GREEN' }
      : { success: true });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Embedded Signup connect orchestration', () => {
  it('exchanges, verifies, claims pending, registers, subscribes, then connects without secrets in response', async () => {
    const result = await connect(input, 'a');
    expect(h.events).toEqual(['exchange', 'verify', 'phone', 'ownership', 'claim', 'register', 'subscribe', 'connected']);
    expect(result.status).toBe('connected');
    expect(Object.keys(result).sort()).toEqual(['id','display_phone_number','verified_name','quality_rating','waba_id','status'].sort());
    expect(JSON.stringify(result)).not.toMatch(/test-business-token|test-oauth-code|ciphertext|pin/i);
  });
  it('rejects asset mismatch before claim/register/subscribe', async () => {
    h.mismatch = true;
    await expect(connect(input, 'a')).rejects.toMatchObject({ code: 'asset_mismatch', status: 403 });
    expect(h.events).toEqual(['exchange','verify']);
  });
  it('rejects another account ownership before register/subscribe', async () => {
    h.owner = 'b';
    await expect(connect(input, 'a')).rejects.toMatchObject({ code: 'phone_in_use', status: 409 });
    expect(h.events).not.toContain('claim'); expect(h.events).not.toContain('register'); expect(h.events).not.toContain('subscribe');
  });
  it('lets exactly one concurrent account win the atomic claim', async () => {
    const results = await Promise.allSettled([connect(input,'a'),connect(input,'b')]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(x => x.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({code:'phone_in_use',status:409});
    expect(h.events.filter(x => x === 'register')).toHaveLength(1);
    expect(h.events.filter(x => x === 'subscribe')).toHaveLength(1);
  });
  it.each(['exchange', 'verify', 'register', 'subscribe'])('sanitizes %s Graph failures and marks claimed rows error', async step => {
    h.failure = step;
    await expect(connect(input,'a')).rejects.toMatchObject({code:'meta_request_failed',status:502});
    expect(h.updates).toEqual(['register','subscribe'].includes(step) ? [expect.objectContaining({status:'error',last_error:'meta_request_failed'})] : []);
    expect(h.events).not.toContain('connected');
  });
  it.each([100, 136024, 133016])('does not swallow unverified registration error %s', async code => {
    h.failure = 'register'; h.metaCode = code;
    vi.spyOn(console,'warn').mockImplementation(() => {});
    await expect(connect(input,'a')).rejects.toBeInstanceOf(SignupError);
    expect(h.events).not.toContain('subscribe');
    expect(h.updates[0]).toMatchObject({status:'error'});
  });
  it('sanitizes transport errors without logging secrets, codes or PINs', async () => {
    const spies = ['log','warn','error','info','debug'].map(m => vi.spyOn(console,m as 'log').mockImplementation(() => {}));
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    let pin = '';
    fetchMock.mockImplementation(async (...args) => {
      if (String(args[0]).includes('/register')) {
        pin = JSON.parse(String(args[1]?.body)).pin;
        throw new Error(`test-business-token test-oauth-code ${pin}`);
      }
      return original(...args);
    });
    await expect(connect(input,'a')).rejects.toMatchObject({code:'meta_request_failed',status:502});
    const logs = JSON.stringify(spies.flatMap(s => s.mock.calls));
    for (const secret of ['test-business-token','test-oauth-code',pin]) expect(logs).not.toContain(secret);
    expect(h.updates[0]).toMatchObject({status:'error',last_error:'meta_request_failed'});
  });
  it('reconnect reuses the saved PIN and keeps the live token/status until Meta succeeds',async () => {
    h.owner='a';h.pinCiphertext=encryptToken('123456');h.liveToken=encryptToken('old-business-token');
    const fetchMock=vi.mocked(fetch);const original=fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (...args) => {
      if(/register|subscribed_apps/.test(String(args[0]))){
        expect(decryptToken(h.liveToken)).toBe('old-business-token');expect(h.ownerStatus).toBe('connected');
      }
      return original(...args);
    });
    await connect(input,'a');expect(h.pins).toEqual(['123456']);
    expect(decryptToken(h.liveToken)).toBe('test-business-token');expect(h.ownerStatus).toBe('connected');
  });
  it.each(['register','subscribe'])('restores a connected row and its old token on reconnect %s failure',async step => {
    h.owner='a';h.pinCiphertext=encryptToken('123456');h.liveToken=encryptToken('old-business-token');h.failure=step;
    const old=h.liveToken;
    await expect(connect(input,'a')).rejects.toMatchObject({code:'meta_request_failed',status:502});
    expect(h.pins).toEqual(['123456']);expect(h.liveToken).toBe(old);expect(h.ownerStatus).toBe('connected');
    expect(h.updates).toEqual([expect.objectContaining({status:'connected',token_ciphertext:old,last_error:'meta_request_failed'})]);
  });
  it('maps the documented register PIN error 133005 to 409 with recovery instructions',async () => {
    h.failure='register';h.metaCode=133005;
    const error=await connect(input,'a').catch(e=>e);
    expect(error).toMatchObject({code:'pin_mismatch',status:409});
    expect(publicError(error)).toMatchObject({status:409,body:{code:'pin_mismatch',message:expect.stringContaining('WhatsApp Manager')}});
    expect(h.updates[0]).toMatchObject({status:'error',last_error:'pin_mismatch'});
  });
  it('allows another account to claim a disconnected number and reuses its PIN',async () => {
    h.owner='b';h.claimed='b';h.ownerStatus='disconnected';h.pinCiphertext=encryptToken('123456');
    await expect(connect(input,'a')).resolves.toMatchObject({status:'connected'});
    expect(h.claimed).toBe('a');expect(h.pins).toEqual(['123456']);
  });
  it('allows exactly one concurrent account to take a disconnected number',async () => {
    h.owner='previous';h.claimed='previous';h.ownerStatus='disconnected';h.pinCiphertext=encryptToken('123456');
    const results=await Promise.allSettled([connect(input,'a'),connect(input,'b')]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((results.find(x=>x.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'phone_in_use',status:409});
    expect(h.pins).toEqual(['123456']);
  });
  it('generates a six-digit PIN on reconnect only when no saved PIN exists',async () => {
    h.owner='a';h.liveToken=encryptToken('old-business-token');
    await connect(input,'a');expect(h.pins).toHaveLength(1);expect(h.pins[0]).toMatch(/^\d{6}$/);
    expect(decryptToken(h.pinCiphertext!)).toBe(h.pins[0]);
  });
  it('does not classify the PIN code from unrelated Graph endpoints as a register mismatch',async () => {
    h.failure='subscribe';h.metaCode=133005;
    await expect(connect(input,'a')).rejects.toMatchObject({code:'meta_request_failed',status:502});
  });
  it('uses the PIN returned by the atomic claim if the pre-check snapshot changed',async () => {
    h.owner='a';h.ownerStatus='error';h.pinCiphertext=encryptToken('123456');h.atomicPin=encryptToken('654321');
    await connect(input,'a');expect(h.pins).toEqual(['654321']);
  });
  it('preserves the original Meta failure when writing error state also fails',async () => {
    h.failure='register';h.metaCode=133005;h.writeFailure=true;
    await expect(connect(input,'a')).rejects.toMatchObject({code:'pin_mismatch',status:409});
  });
  it('claims pending in review-only SQL with unambiguous columns and an empty search path', () => {
    const sql = readFileSync('supabase/shared-project/wacrm_embedded_signup.sql','utf8');
    expect(sql).toContain("('pending','connected','disconnected','error')");
    expect(sql).toContain("p_pin_ciphertext,'pending'");
    expect(sql).toContain("ELSE 'pending' END");
    expect(sql).toContain('#variable_conflict use_column');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain("WHERE c.account_id=EXCLUDED.account_id OR c.status='disconnected'");
    expect(sql).toContain('account_id=EXCLUDED.account_id');
    expect(sql).toContain('pin_ciphertext=COALESCE(c.pin_ciphertext, EXCLUDED.pin_ciphertext)');
    expect(sql).toContain("token_ciphertext=CASE WHEN c.status='connected' THEN c.token_ciphertext");
    expect(sql).toContain("current_setting('role', true) IS DISTINCT FROM 'service_role'");
    expect(sql.indexOf('DROP POLICY IF EXISTS')).toBeLessThan(sql.indexOf('CREATE POLICY'));
  });
});

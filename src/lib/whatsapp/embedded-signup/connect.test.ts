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
  selections:[] as {fields:string;filters:Record<string,unknown>}[],
  returnedPins:[] as string[],pinReadError:false,
  updatedAt:'',legacyAccount:null as string|null,legacyError:false,
  updateAttempts:[] as Record<string,unknown>[],legacyFilters:[] as [string,unknown][],
  events: [] as string[],
  updates: [] as Record<string, unknown>[],
  claimError: false,
  mismatch: false, multi:false,
  failure: '' as string,
  metaCode: 100,biz:false,syncs:[] as string[],debugTargets:['123'],syncErrorCode:null as number|null,
}));
vi.mock('node:crypto',async importOriginal=>({
  ...await importOriginal<typeof import('node:crypto')>(),
  randomInt:vi.fn(()=>654321),
}));
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: () => ({
  schema: (schema: string) => {
    expect(schema).toBe('wacrm');
    return {
      from: (table:string) => table==='whatsapp_config' ? {
        select: () => {
          let excluded='';
          const q={
            eq:(key:string,value:unknown)=>{h.legacyFilters.push([key,value]);return q;},
            neq:(key:string,value:string)=>{excluded=value;h.legacyFilters.push(['not.'+key,value]);return q;},
            limit:async()=>{
              h.events.push('legacy');
              return {data:h.legacyAccount && h.legacyAccount!==excluded?[{account_id:h.legacyAccount}]:[],error:h.legacyError?{message:'private-db-details'}:null};
            },
          };return q;
        },
      } : ({
        select: (fields:string) => {
          const filters:Record<string,unknown>={};
          const q={
            eq:(key:string,value:unknown)=>{filters[key]=value;return q;},
            maybeSingle:async()=>{
              h.selections.push({fields,filters});
              if(fields==='pin_ciphertext'){
                expect(filters.account_id).toBe('a');
                return {data:h.owner===filters.account_id?{pin_ciphertext:h.pinCiphertext}:null,error:h.pinReadError?{message:'private-db-details'}:null};
              }
              h.events.push('ownership');
              return {data:h.owner?{account_id:h.owner,status:h.ownerStatus,updated_at:h.updatedAt}:null,error:null};
            },
          };return q;
        },
        update: (patch: Record<string, unknown>) => {
          const filters:Record<string,unknown>={};
          const q={
            eq:(key:string,value:unknown)=>{filters[key]=value;return q;},
            select:async()=>{
              h.updateAttempts.push({...patch,expected_status:filters.status});
              if(h.writeFailure) throw new Error('simulated write failure');
              if(h.ownerStatus!==filters.status || h.claimed!==filters.account_id)return {data:[],error:null};
              h.events.push(String(patch.status));h.updates.push(patch);
              if(typeof patch.token_ciphertext==='string')h.liveToken=patch.token_ciphertext;
              h.ownerStatus=String(patch.status);return {data:[{id:'connection-id'}],error:null};
            },
          };return q;
        },
      }),
      rpc: async (_name: string, args: Record<string, string>) => {
        h.events.push('claim');
        const recoverable=h.ownerStatus==='disconnected' || h.ownerStatus==='error'
          || (h.ownerStatus==='pending' && Date.parse(h.updatedAt)<Date.now()-15*60*1000);
        if (h.claimError || (h.claimed && h.claimed !== args.p_account_id && !recoverable))
          return { data: null, error: { code: '23505', message: 'wa_connection_owned' } };
        const sameAccount=(h.claimed || h.owner)===args.p_account_id;
        const wasConnected=sameAccount && h.ownerStatus==='connected';
        h.claimed = args.p_account_id;
        if(!wasConnected){h.ownerStatus='pending';h.liveToken=args.p_token_ciphertext;h.updatedAt=new Date(Date.now()).toISOString();}
        h.pinCiphertext=sameAccount?(h.atomicPin || h.pinCiphertext || args.p_pin_ciphertext):args.p_pin_ciphertext;
        h.returnedPins.push(h.pinCiphertext);
        expect(decryptToken(args.p_token_ciphertext)).toBe('test-business-token');
        if(args.p_pin_ciphertext!==null)expect(decryptToken(args.p_pin_ciphertext)).toMatch(/^\d{6}$/);
        return { data: [{ id: 'connection-id', waba_id: args.p_waba_id, status: wasConnected?'connected':'pending',
          claimed_pin_ciphertext:h.pinCiphertext,stored_token_ciphertext:h.liveToken,
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
  h.multi=false;h.mismatch = false; h.failure = ''; h.metaCode = 100;
  h.ownerStatus='connected';h.pinCiphertext=null;h.atomicPin=null;h.liveToken='';h.writeFailure=false;h.pins=[];h.updatedAt=new Date(Date.now()).toISOString();h.legacyAccount=null;h.legacyError=false;h.updateAttempts=[];h.legacyFilters=[];h.selections=[];h.returnedPins=[];h.pinReadError=false;h.biz=false;h.syncs=[];h.debugTargets=['123'];h.syncErrorCode=null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const step = url.includes('debug_token')?'debug':url.includes('smb_app_data')?'sync':url.includes('oauth/access_token') ? 'exchange' : url.includes('/phone_numbers') ? 'verify'
      : url.includes('/register') ? 'register' : url.includes('/subscribed_apps') ? 'subscribe' : 'phone';
    h.events.push(step);
    if(step==='sync'&&h.syncErrorCode!==null){h.syncs.push(JSON.parse(String(options?.body)).sync_type);return Response.json({error:{code:h.syncErrorCode,message:'test-business-token'}},{status:400});}
    if(step==='sync'){const payload=JSON.parse(String(options?.body));h.syncs.push(payload.sync_type);return Response.json({messaging_product:'whatsapp',request_id:'request-'+payload.sync_type});}
    if(step==='debug')return Response.json({data:{is_valid:true,app_id:'test-app',granular_scopes:[{scope:'whatsapp_business_management',target_ids:h.debugTargets}]}});
    if(step==='register')h.pins.push(JSON.parse(String(options?.body)).pin);
    if (h.failure === step) return Response.json({ error: { code: h.metaCode, message: 'test-business-token test-oauth-code' } }, { status: 400 });
    return Response.json(step === 'exchange' ? { access_token: 'test-business-token' }
      : step === 'verify' ? { data: h.multi?[{id:'456',display_phone_number:'+123',verified_name:'First'},{id:'789',display_phone_number:'+789',verified_name:'Second'}]:[{ id: h.mismatch ? '999' : '456' }] }
      : step === 'phone' ? { display_phone_number: '+123', verified_name: 'Test', quality_rating: 'GREEN',...(h.biz?{is_on_biz_app:true,platform_type:'CLOUD_API'}:{}) }
      : { success: true });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Embedded Signup connect orchestration', () => {
  it('exchanges, verifies, claims pending, registers, subscribes, then connects without secrets in response', async () => {
    const result = await connect(input, 'a');
    expect(h.events).toEqual(['exchange', 'verify', 'phone', 'legacy', 'ownership', 'claim', 'register', 'subscribe', 'connected']);
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
    expect(h.updates).toEqual(['register','subscribe'].includes(step) ? [expect.objectContaining({status:'error',last_error:'Meta 100: WhatsApp connection request failed.'})] : []);
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
    expect(h.updates[0]).toMatchObject({status:'error',last_error:'WhatsApp: WhatsApp connection request failed.'});
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
    expect(h.updates).toEqual([expect.objectContaining({status:'connected',token_ciphertext:old,last_error:'Meta 100: WhatsApp connection request failed.'})]);
  });
  it('maps the documented register PIN error 133005 to 409 with recovery instructions',async () => {
    h.failure='register';h.metaCode=133005;
    const error=await connect(input,'a').catch(e=>e);
    expect(error).toMatchObject({code:'pin_mismatch',status:409});
    expect(publicError(error)).toMatchObject({status:409,body:{code:'pin_mismatch',message:expect.stringContaining('WhatsApp Manager')}});
    expect(h.updates[0]).toMatchObject({status:'error',last_error:'Meta 133005: Two-step verification PIN is incorrect. Turn off two-step verification for this number in WhatsApp Manager, then retry.'});
  });
  it('uses a fresh PIN without receiving the former accounts ciphertext on takeover',async () => {
    h.owner='b';h.claimed='b';h.ownerStatus='disconnected';h.pinCiphertext=encryptToken('123456');const formerPin=h.pinCiphertext;
    await expect(connect(input,'a')).resolves.toMatchObject({status:'connected'});
    expect(h.claimed).toBe('a');expect(h.pins).toEqual(['654321']);
    expect(h.returnedPins).not.toContain(formerPin);
    expect(h.selections.every(x=>!x.fields.includes('pin_ciphertext'))).toBe(true);
  });
  it('allows exactly one concurrent account to take a disconnected number',async () => {
    h.owner='previous';h.claimed='previous';h.ownerStatus='disconnected';h.pinCiphertext=encryptToken('123456');const formerPin=h.pinCiphertext;
    const results=await Promise.allSettled([connect(input,'a'),connect(input,'b')]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((results.find(x=>x.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({code:'phone_in_use',status:409});
    expect(h.pins).toEqual(['654321']);
    expect(h.returnedPins).not.toContain(formerPin);
    expect(h.selections.every(x=>!x.fields.includes('pin_ciphertext'))).toBe(true);
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
  it.each(['error','stale-pending'])('allows another account to recover a %s number',async state=>{
    h.owner='b';h.claimed='b';h.ownerStatus=state==='error'?'error':'pending';
    h.updatedAt=new Date(Date.now()-16*60*1000).toISOString();h.pinCiphertext=encryptToken('123456');
    await expect(connect(input,'a')).resolves.toMatchObject({status:'connected'});
    expect(h.claimed).toBe('a');expect(h.pins).toEqual(['654321']);
    expect(h.selections.every(x=>!x.fields.includes('pin_ciphertext'))).toBe(true);
  });
  it.each(['fresh','exact-cutoff','invalid-timestamp'])('rejects another accounts %s pending claim before register',async age=>{
    vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-30T00:00:00Z'));
    h.owner='b';h.claimed='b';h.ownerStatus='pending';
    h.updatedAt=age==='invalid-timestamp'?'invalid':new Date(Date.now()-(age==='fresh'?14:15)*60*1000).toISOString();
    await expect(connect(input,'a')).rejects.toMatchObject({code:'phone_in_use',status:409});
    expect(h.events).not.toContain('claim');expect(h.pins).toEqual([]);
  });
  it.each(['pending','connected'])('does not reconnect over a disconnect during a %s connect',async state=>{
    if(state==='connected'){h.owner='a';h.pinCiphertext=encryptToken('123456');h.liveToken=encryptToken('old-business-token');}
    const fetchMock=vi.mocked(fetch);const original=fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async(...args)=>{
      const response=await original(...args);
      if(String(args[0]).includes('/subscribed_apps'))h.ownerStatus='disconnected';
      return response;
    });
    await expect(connect(input,'a')).rejects.toMatchObject({code:'state_changed',status:409});
    expect(h.ownerStatus).toBe('disconnected');expect(h.updates).toEqual([]);
    expect(h.updateAttempts).toHaveLength(1);expect(h.updateAttempts[0].expected_status).toBe(state);
  });
  it.each(['pending','connected'])('does not restore over a disconnect after a %s registration failure',async state=>{
    if(state==='connected'){h.owner='a';h.pinCiphertext=encryptToken('123456');h.liveToken=encryptToken('old-business-token');}
    h.failure='register';
    const fetchMock=vi.mocked(fetch);const original=fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async(...args)=>{
      const response=await original(...args);
      if(String(args[0]).includes('/register'))h.ownerStatus='disconnected';
      return response;
    });
    await expect(connect(input,'a')).rejects.toMatchObject({code:'state_changed',status:409});
    expect(h.ownerStatus).toBe('disconnected');expect(h.updates).toEqual([]);
    expect(h.updateAttempts).toHaveLength(1);expect(h.updateAttempts[0].expected_status).toBe(state);
  });
  it('blocks another accounts legacy number before claim/register/subscribe',async()=>{
    h.legacyAccount='b';
    await expect(connect(input,'a')).rejects.toMatchObject({code:'number_in_use_legacy',status:409});
    expect(h.legacyFilters).toContainEqual(['phone_number_id','456']);
    expect(h.legacyFilters).toContainEqual(['not.account_id','a']);
    expect(h.events).not.toContain('claim');expect(h.pins).toEqual([]);expect(h.events).not.toContain('subscribe');
  });
  it('allows the same accounts legacy number',async()=>{
    h.legacyAccount='a';await expect(connect(input,'a')).resolves.toMatchObject({status:'connected'});
  });
  it('fails closed on a legacy ownership lookup DB error',async()=>{
    h.legacyError=true;
    await expect(connect(input,'a')).rejects.toMatchObject({code:'database_error',status:500});
    expect(h.events).not.toContain('claim');expect(h.pins).toEqual([]);
  });
  it('never loads or decrypts a former accounts malformed PIN ciphertext on takeover',async()=>{
    h.owner='b';h.claimed='b';h.ownerStatus='error';h.pinCiphertext='former-account-ciphertext';
    await expect(connect(input,'a')).resolves.toMatchObject({status:'connected'});
    expect(h.pins).toEqual(['654321']);expect(h.returnedPins).not.toContain('former-account-ciphertext');
    expect(h.selections.every(x=>!x.fields.includes('pin_ciphertext'))).toBe(true);
  });
  it('uses the existing PIN mismatch recovery path when a fresh takeover PIN is rejected',async()=>{
    h.owner='b';h.claimed='b';h.ownerStatus='disconnected';h.pinCiphertext=encryptToken('123456');
    h.failure='register';h.metaCode=133005;
    const error=await connect(input,'a').catch(e=>e);
    expect(error).toMatchObject({code:'pin_mismatch',status:409});expect(h.pins).toEqual(['654321']);
    expect(publicError(error).body.message).toContain('WhatsApp Manager');
  });
  it('reads a retained same-account PIN through a scoped lookup and fails closed on lookup error',async()=>{
    h.owner='a';h.pinReadError=true;h.pinCiphertext=encryptToken('123456');
    await expect(connect(input,'a')).rejects.toMatchObject({code:'database_error',status:500});
    expect(h.selections).toContainEqual({fields:'pin_ciphertext',filters:{phone_number_id:'456',account_id:'a'}});
    expect(h.events).not.toContain('claim');expect(h.pins).toEqual([]);
  });
  it('coexistence skips register and PIN creation, subscribes, and initiates documented contacts/history sync',async()=>{
    h.biz=true;await expect(connect({...input,mode:'coexistence'},'a')).resolves.toMatchObject({status:'connected'});
    expect(h.events).not.toContain('register');expect(h.pins).toEqual([]);expect(h.pinCiphertext).toBeNull();
    expect(h.syncs).toEqual(['smb_app_state_sync','history']);
    expect(h.events.indexOf('subscribe')).toBeLessThan(h.events.indexOf('sync'));
    expect(vi.mocked(fetch).mock.calls.every(([url])=>String(url).includes('/v26.0/'))).toBe(true);
  });
  it('standard onboarding still registers and does not request app-history sync',async()=>{
    await connect({...input,mode:'standard'},'a');expect(h.events).toContain('register');expect(h.events).toContain('subscribe');expect(h.syncs).toEqual([]);
  });
  it('discovers missing callback asset IDs with debug_token and phone_numbers and infers coexistence',async()=>{
    h.biz=true;await expect(connect({code:'test-oauth-code',source:'hosted'},'a')).resolves.toMatchObject({waba_id:'123'});
    expect(h.events).toContain('debug');expect(h.events).not.toContain('register');expect(h.syncs).toHaveLength(2);
  });
  it('rejects ambiguous callback WABAs instead of silently choosing assets',async()=>{
    h.debugTargets=['123','999'];await expect(connect({code:'test-oauth-code',source:'hosted'},'a')).rejects.toMatchObject({code:'asset_selection_required',status:400});expect(h.events).not.toContain('claim');
  });
  it('does not trust a coexistence mode flag for a number not verified on the Business app',async()=>{
    await expect(connect({...input,mode:'coexistence'},'a')).rejects.toMatchObject({code:'asset_mismatch',status:403});expect(h.events).not.toContain('claim');
  });
  it('retrying coexistence after an earlier error on the same account runs both syncs',async()=>{
    h.biz=true;h.owner='a';h.ownerStatus='error';
    await expect(connect({...input,mode:'coexistence'},'a')).resolves.toMatchObject({status:'connected'});
    expect(h.syncs).toEqual(['smb_app_state_sync','history']);
  });
  it('reconnecting an already-connected coexistence row does not sync again',async()=>{
    h.biz=true;h.owner='a';h.ownerStatus='connected';
    await expect(connect({...input,mode:'coexistence'},'a')).resolves.toMatchObject({status:'connected'});
    expect(h.syncs).toEqual([]);
  });
  it('treats an already-synced Meta error as non-fatal and logs only the code',async()=>{
    h.biz=true;h.syncErrorCode=2593107;const info=vi.spyOn(console,'info').mockImplementation(()=>{});
    await expect(connect({...input,mode:'coexistence'},'a')).resolves.toMatchObject({status:'connected'});
    expect(h.syncs).toEqual(['smb_app_state_sync','history']);
    expect(JSON.stringify(info.mock.calls)).not.toContain('test-business-token');
  });
  it('keeps other sync errors fatal',async()=>{
    h.biz=true;h.syncErrorCode=100;
    await expect(connect({...input,mode:'coexistence'},'a')).rejects.toMatchObject({code:'meta_request_failed'});
    expect(h.ownerStatus).toBe('error');
  });
  it('syncs when a connected standard row of the account switches to coexistence',async()=>{
    h.biz=true;h.owner='a';h.ownerStatus='connected';h.pinCiphertext=encryptToken('123456');
    await expect(connect({...input,mode:'coexistence'},'a')).resolves.toMatchObject({status:'connected'});
    expect(h.syncs).toEqual(['smb_app_state_sync','history']);
  });
  it('rejects standard onboarding of a Business-app number before claim or register',async()=>{
    h.biz=true;
    await expect(connect({...input,mode:'standard'},'a')).rejects.toMatchObject({code:'coexistence_required',status:409});
    expect(h.events).not.toContain('claim');expect(h.events).not.toContain('register');
    expect(publicError(new SignupError('coexistence_required',409)).body).toMatchObject({code:'coexistence_required'});
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
    expect(sql).toContain('pin_ciphertext=CASE WHEN c.account_id=EXCLUDED.account_id');
    expect(sql).toContain('THEN COALESCE(c.pin_ciphertext, EXCLUDED.pin_ciphertext)');
    expect(sql).toContain('ELSE EXCLUDED.pin_ciphertext END');
    expect(sql).toContain('claimed_pin_ciphertext text,stored_token_ciphertext text');
    expect(sql).not.toContain('previous_token_ciphertext');
    expect(sql).toContain('DROP TRIGGER IF EXISTS set_updated_at ON wacrm.wa_connections;');
    expect(sql).toContain('CREATE TRIGGER set_updated_at BEFORE UPDATE ON wacrm.wa_connections');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION wacrm.update_updated_at_column();');
    expect(sql).toContain("token_ciphertext=CASE WHEN c.status='connected' THEN c.token_ciphertext");
    expect(sql).toContain("current_setting('role', true) IS DISTINCT FROM 'service_role'");
    expect(sql.indexOf('DROP POLICY IF EXISTS')).toBeLessThan(sql.indexOf('CREATE POLICY'));
    expect(sql).toContain("OR c.status='error'");
    expect(sql).toContain("OR (c.status='pending' AND c.updated_at < now() - interval '15 minutes')");
    const signature='DROP FUNCTION IF EXISTS wacrm.claim_wa_connection(uuid,text,text,text,text,text,text,text,text);';
    expect(sql.indexOf(signature)).toBeGreaterThan(-1);
    expect(sql.indexOf(signature)).toBeLessThan(sql.indexOf('CREATE OR REPLACE FUNCTION wacrm.claim_wa_connection'));
    expect(readFileSync('supabase/shared-project/rollback_wacrm_embedded_signup.sql','utf8')).toContain(signature);
  });
});

describe('number selection',()=>{
 it('returns multi-number choices and resumes a valid choice without exchanging the code again',async()=>{
  h.multi=true;
  const selection=await connect(input,'a');
  expect(selection).toMatchObject({status:'selection_required',choices:[{id:'456',display_phone_number:'+123',verified_name:'First'},{id:'789'}]});
  expect(h.events).not.toContain('claim');
  const result=await connect({...input,phone_number_id:'789',continuation:selection.continuation},'a');
  expect(result.status).toBe('connected');
  expect(h.events.filter(e=>e==='exchange')).toHaveLength(1);
 });
 it('rejects a foreign phone id before writes',async()=>{
  h.multi=true;const selection=await connect({...input,phone_number_id:undefined},'a');
  await expect(connect({...input,phone_number_id:'999',continuation:selection.continuation},'a')).rejects.toMatchObject({code:'asset_mismatch'});
  expect(h.events).not.toContain('claim');
 });
 it('auto-selects a single number',async()=>{
  expect((await connect({...input,phone_number_id:undefined},'a')).status).toBe('connected');
 });
 it('rejects tampered, expired, and cross-account continuations',async()=>{
  h.multi=true;const selection=await connect({...input,phone_number_id:undefined},'a');
  await expect(connect({...input,continuation:selection.continuation},'b')).rejects.toMatchObject({code:'invalid_continuation'});
  await expect(connect({...input,continuation:'tampered'},'a')).rejects.toMatchObject({code:'invalid_continuation'});
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+600001);
  await expect(connect({...input,continuation:selection.continuation},'a')).rejects.toMatchObject({code:'invalid_continuation'});
 });
});

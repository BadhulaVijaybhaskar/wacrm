import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { GET as config } from './config/route';
import { POST as health } from './health/route';
import { POST as complete } from './complete/route';
import { GET as connections } from './connections/route';
import { POST as disconnect } from './connections/[id]/disconnect/route';
import {issueCallbackState,validCallbackState,CALLBACK_COOKIE} from '@/lib/whatsapp/embedded-signup/callback-state';
import { encryptToken } from '@/lib/whatsapp/embedded-signup/crypto';

const h = vi.hoisted(() => ({
  auth: vi.fn(), row: null as null | Record<string, unknown>, patches: [] as Record<string, unknown>[],
  failure: '' as string, owner: null as null | string, dbError: false,
  legacyNumber:false,legacyAccount:null as string|null,legacyError:false,emptyUpdate:false,
  metaCode:100,siblings:[] as {id:string}[],siblingError:false,filters:[] as [string,unknown][],
}));
vi.mock('@/lib/auth/account', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth/account')>(),
  requireRole: () => h.auth(), getCurrentAccount: () => h.auth(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: () => ({ schema: (schema: string) => {
  expect(schema).toBe('wacrm');
  return {
    from: (table:string) => ({
      select: (fields: string) => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (key: string, value: unknown) => { filters[key] = value; h.filters.push([key,value]);return q; },
          neq: (key:string,value:unknown) => {filters['not.'+key]=value;h.filters.push(['not.'+key,value]);return q;},
          in: (key:string,value:unknown) => {h.filters.push([key,value]);return q;},
          limit: async () => table==='whatsapp_config'
            ? {data:fields==='account_id'?(h.legacyAccount && h.legacyAccount!==filters['not.account_id']?[{account_id:h.legacyAccount}]:[]):h.legacyNumber?[{id:'legacy-number'}]:[],error:h.legacyError?{code:'private-db-error'}:null}
            : {data:h.siblings,error:h.siblingError?{code:'test'}:null},
          order: async () => ({ data: h.row ? [h.row] : [], error: h.dbError ? {code:'test'} : null }),
          maybeSingle: async () => ({
            data: fields.includes('account_id') ? (h.owner ? {account_id:h.owner,status:'connected'} : null)
              : h.row && filters.account_id === h.row.account_id ? h.row : null,
            error: h.dbError ? {code:'test'} : null,
          }),
        };
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        const q={
          eq:()=>q,
          select:async()=>{
            if(h.emptyUpdate)return {data:[],error:null};
            h.patches.push(patch);return {data:[{id:'connection'}],error:null};
          },
          then:(resolve:(result:unknown)=>unknown)=>{
            h.patches.push(patch);return Promise.resolve({error:null}).then(resolve);
          },
        };return q;
      },
    }),
    rpc: async () => ({data:[{id:'connection',status:'pending',waba_id:'123'}],error:null}),
  };
} }) }));
const id = '12345678-1234-4234-8234-123456789012';
const signedState = () => issueCallbackState('a','test-secret');
const req = (body?: unknown) => {
  const issued = signedState();
  const payload = body === undefined
    ? {code:'test-code',waba_id:'123',phone_number_id:'456',source:'popup',state:issued.state} : body;
  return new Request('https://test.invalid', {
    method:'POST',headers:{'Content-Type':'application/json',cookie:CALLBACK_COOKIE+'='+issued.cookie},body:JSON.stringify(payload),
  });
};
const disconnectReq = () => disconnect(req(),{params:Promise.resolve({id})});
beforeEach(() => {
  vi.stubEnv('WACRM_ES_STATE_SECRET','');
  vi.stubEnv('WACRM_EMBEDDED_SIGNUP','1'); vi.stubEnv('META_APP_ID','test-app'); vi.stubEnv('META_APP_SECRET','test-secret');
  vi.stubEnv('WACRM_TOKEN_ENC_KEY',Buffer.alloc(32,2).toString('base64'));
  h.auth.mockResolvedValue({accountId:'a',role:'admin'}); h.row=null; h.patches=[];h.failure='';h.owner=null;h.dbError=false;h.siblings=[];h.siblingError=false;h.filters=[];h.metaCode=100;h.legacyNumber=false;h.legacyAccount=null;h.legacyError=false;h.emptyUpdate=false;
  vi.stubGlobal('fetch',vi.fn(async (url: string) => {
    if(h.failure && url.includes(h.failure)) return Response.json({error:{code:h.metaCode,message:'test-code test-token'}},{status:400});
    return Response.json(url.includes('oauth') ? {access_token:'test-token'} : url.includes('/phone_numbers')
      ? {data:[{id:'456'}]} : {success:true});
  }));
});
afterEach(() => {vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('Embedded Signup routes', () => {
  it('completes with only public connection fields',async () => {
    const r=await complete(req());expect(r.status).toBe(200);
    const body=await r.json();expect(body.status).toBe('connected');
    expect(JSON.stringify(body)).not.toMatch(/test-token|test-code|ciphertext|pin/i);
  });
  it('preserves SignupError 409 and 502',async () => {
    h.owner='b';expect((await complete(req())).status).toBe(409);
    h.owner=null;h.failure='/register';const r=await complete(req());expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({error:'meta_request_failed'});
  });
  it('preserves asset mismatch 403',async () => {
    vi.mocked(fetch).mockImplementation(async (url) => Response.json(String(url).includes('oauth')
      ? {access_token:'test-token'} : {data:[{id:'999'}]}));
    const r=await complete(req());expect(r.status).toBe(403);expect(await r.json()).toMatchObject({error:'asset_mismatch'});
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });
  it.each([new ForbiddenError(),new UnauthorizedError()])('returns forbidden for auth error %s',async error => {
    h.auth.mockRejectedValue(error);
    const r=await complete(req());expect(r.status).toBe(error.status);expect(await r.json()).toEqual({error:'forbidden'});
    expect((await disconnectReq()).status).toBe(error.status);expect((await connections()).status).toBe(error.status);expect((await config()).status).toBe(error.status);expect((await health()).status).toBe(error.status);expect(fetch).not.toHaveBeenCalled();
  });
  it('returns 500 for unexpected failures',async () => {
    h.auth.mockRejectedValue(new Error('test-code test-token'));
    const r=await complete(req());expect(r.status).toBe(500);expect(await r.json()).toMatchObject({error:'internal_error'});
    expect((await connections()).status).toBe(500);expect((await disconnectReq()).status).toBe(500);
  });
  it.each([{},null,{code:'c',waba_id:'bad',phone_number_id:'456'},{code:'c',waba_id:'123',phone_number_id:'456',token:'x'}])('rejects invalid body %j with 400',async body => {
    const r=await complete(req(body));expect(r.status).toBe(400);expect(await r.json()).toMatchObject({error:'invalid_request'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns 400 for malformed JSON',async () => {
    expect((await complete(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}))).status).toBe(400);
  });
  it('returns 404 on all three routes when flag is off before auth or side effects',async () => {
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP','0');
    for(const r of [await complete(req()),await connections(),await disconnectReq(),await config(),await health()]) expect(r.status).toBe(404);
    expect(h.auth).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('disconnect hides another accounts connection',async () => {
    h.row={id,account_id:'b',status:'connected'};
    const r=await disconnectReq();expect(r.status).toBe(404);expect(fetch).not.toHaveBeenCalled();expect(h.patches).toEqual([]);
  });
  it.each(['connected','error','pending'])('disconnect Meta failure on %s marks row error and returns 502',async status => {
    h.row={id,account_id:'a',status,waba_id:'123',token_ciphertext:encryptToken('test-token')};h.failure='/subscribed_apps';
    const r=await disconnectReq();expect(r.status).toBe(502);expect(await r.json()).toEqual({error:'meta_request_failed'});
    expect(h.patches).toEqual([expect.objectContaining({status:'error',last_error:'Meta 100: WhatsApp connection request failed.'})]);
  });
  it('disconnect success unsubscribes and marks disconnected',async () => {
    h.row={id,account_id:'a',status:'connected',waba_id:'123',token_ciphertext:encryptToken('test-token')};
    const r=await disconnectReq();expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'disconnected'});
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/123/subscribed_apps'),expect.objectContaining({method:'DELETE'}));
    expect(h.patches).toEqual([expect.objectContaining({status:'disconnected',last_error:null})]);
  });
  it.each(['connected','pending'])('disconnect retains shared WABA subscription when a sibling is %s',async status => {
    h.row={id,account_id:'a',status:'connected',waba_id:'123',token_ciphertext:encryptToken('test-token')};
    // The query covers every account sharing the WABA; the sibling may be elsewhere.
    h.siblings=[{id:'other-number-'+status}];
    const r=await disconnectReq();expect(r.status).toBe(200);expect(fetch).not.toHaveBeenCalled();
    expect(h.patches).toEqual([expect.objectContaining({status:'disconnected'})]);
    expect(h.filters).toContainEqual(['waba_id','123']);expect(h.filters).toContainEqual(['not.id',id]);
    expect(h.filters).toContainEqual(['status',['connected','pending']]);
  });
  it('fails closed without unsubscribe on sibling query error',async () => {
    h.row={id,account_id:'a',status:'connected',waba_id:'123',token_ciphertext:encryptToken('test-token')};h.siblingError=true;
    expect((await disconnectReq()).status).toBe(500);expect(fetch).not.toHaveBeenCalled();expect(h.patches).toEqual([]);
  });
  it('returns 409 pin_mismatch and safe instructions through the complete route',async () => {
    h.metaCode=133005;h.failure='/register';
    const r=await complete(req());expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({code:'pin_mismatch',message:expect.stringContaining('Turn off two-step verification')});
  });
  it('returns 500 for connections database errors',async () => {
    h.dbError=true;const r=await connections();expect(r.status).toBe(500);
    expect(await r.json()).toEqual({error:'database_error'});
  });
  it('does not unsubscribe a WABA still used by any legacy config',async()=>{
    h.row={id,account_id:'a',status:'connected',waba_id:'123',token_ciphertext:encryptToken('test-token')};
    h.legacyNumber=true;
    const r=await disconnectReq();expect(r.status).toBe(200);expect(fetch).not.toHaveBeenCalled();
    expect(h.patches).toEqual([expect.objectContaining({status:'disconnected'})]);
    expect(h.filters).toContainEqual(['waba_id','123']);
  });
  it('fails closed before unsubscribe if the legacy WABA lookup fails',async()=>{
    h.row={id,account_id:'a',status:'connected',waba_id:'123',token_ciphertext:encryptToken('test-token')};
    h.legacyError=true;
    expect((await disconnectReq()).status).toBe(500);expect(fetch).not.toHaveBeenCalled();expect(h.patches).toEqual([]);
  });
  it('returns 409 number_in_use_legacy instead of taking another accounts legacy number',async()=>{
    h.legacyAccount='b';const r=await complete(req());expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({error:'number_in_use_legacy'});
    expect(vi.mocked(fetch).mock.calls.some(args=>/register|subscribed_apps/.test(String(args[0])))).toBe(false);
    expect(h.patches).toEqual([]);
  });
  it('returns 409 state_changed when the guarded connect update affects zero rows',async()=>{
    h.emptyUpdate=true;const r=await complete(req());expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({error:'state_changed'});expect(h.patches).toEqual([]);
  });
  it('rejects an unbound callback code before any Graph call',async()=>{
    const r=await complete(req({code:'code',source:'hosted',state:'untrusted'}));expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({error:'callback_state_invalid'});expect(fetch).not.toHaveBeenCalled();
  });
  it('completes a signed account-bound callback through the same core and clears its cookie',async()=>{
    const issued=issueCallbackState('a','test-secret');
    const request=req({code:'test-code',source:'hosted',state:issued.state,waba_id:'123',phone_number_id:'456'});
    request.headers.set('cookie',CALLBACK_COOKIE+'='+issued.cookie);
    const r=await complete(request);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({status:'connected'});
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  describe('callback state for popup completions',()=>{
    const popupBody=(state?:string)=>({code:'test-code',waba_id:'123',phone_number_id:'456',source:'popup',...(state?{state}:{})});
    const withCookie=(body:unknown,cookie?:string,headers:Record<string,string>={})=>{
      const request=new Request('https://test.invalid',{method:'POST',
        headers:{'Content-Type':'application/json',...(cookie?{cookie:CALLBACK_COOKIE+'='+cookie}:{}),...headers},body:JSON.stringify(body)});
      return request;
    };
    it('uses the dedicated secret in both config issuance and completion verification',async()=>{
      vi.stubEnv('WACRM_ES_STATE_SECRET','dedicated-test-key');
      const response=await config();const body=await response.json();
      const cookie=response.cookies.get(CALLBACK_COOKIE)!.value;
      expect(validCallbackState(body.state,cookie,'a','dedicated-test-key')).toBe(true);
      expect(validCallbackState(body.state,cookie,'a','test-secret')).toBe(false);
      expect((await complete(withCookie(popupBody(body.state),cookie))).status).toBe(200);
    });
    it('rejects legacy-key state when the dedicated secret is configured',async()=>{
      vi.stubEnv('WACRM_ES_STATE_SECRET','dedicated-test-key');
      const issued=signedState();
      const response=await complete(withCookie(popupBody(issued.state),issued.cookie));
      expect(response.status).toBe(403);expect(fetch).not.toHaveBeenCalled();expect(h.patches).toEqual([]);
    });
    it('rejects a popup completion without state with 403 and clears the cookie',async()=>{
      const issued=signedState();const r=await complete(withCookie(popupBody(),issued.cookie));
      expect(r.status).toBe(403);expect(await r.json()).toMatchObject({error:'callback_state_invalid'});
      expect(r.headers.get('set-cookie')).toContain('Max-Age=0');expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects state issued for another account',async()=>{
      const issued=issueCallbackState('other','test-secret');const r=await complete(withCookie(popupBody(issued.state),issued.cookie));
      expect(r.status).toBe(403);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects expired state',async()=>{
      const issued=issueCallbackState('a','test-secret',Date.now()-700000);const r=await complete(withCookie(popupBody(issued.state),issued.cookie));
      expect(r.status).toBe(403);expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects tampered state and tampered cookie',async()=>{
      const issued=signedState();
      expect((await complete(withCookie(popupBody('0'.repeat(48)),issued.cookie))).status).toBe(403);
      const [payload,signature]=issued.cookie.split('.');
      const forged=payload+'.'+(signature[0]==='a'?'b':'a')+signature.slice(1);
      const r=await complete(withCookie(popupBody(issued.state),forged));
      expect(r.status).toBe(403);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');expect(fetch).not.toHaveBeenCalled();
    });
    it('rejects a missing state cookie',async()=>{
      const issued=signedState();expect((await complete(withCookie(popupBody(issued.state)))).status).toBe(403);
    });
    it('rejects a non-JSON content type with 415 before any work',async()=>{
      const issued=signedState();
      const r=await complete(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'text/plain',cookie:CALLBACK_COOKIE+'='+issued.cookie},body:JSON.stringify(popupBody(issued.state))}));
      expect(r.status).toBe(415);expect(h.auth).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
      expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    });
    it('rejects a foreign Origin with 403',async()=>{
      const issued=signedState();const r=await complete(withCookie(popupBody(issued.state),issued.cookie,{Origin:'https://evil.example'}));
      expect(r.status).toBe(403);expect(h.auth).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
      expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    });
    it('rejects Sec-Fetch-Site: cross-site with 403',async()=>{
      const issued=signedState();const r=await complete(withCookie(popupBody(issued.state),issued.cookie,{'Sec-Fetch-Site':'cross-site'}));
      expect(r.status).toBe(403);expect(h.auth).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
      expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    });
    it('accepts the request origin and the configured site origin',async()=>{
      for(const origin of ['https://test.invalid','https://crm.example']){
        vi.stubEnv('NEXT_PUBLIC_SITE_URL','https://crm.example');
        const issued=signedState();
        const r=await complete(withCookie(popupBody(issued.state),issued.cookie,{Origin:origin}));expect(r.status).toBe(200);
      }
    });
    it('completes a valid popup request and clears the cookie',async()=>{
      const issued=signedState();const r=await complete(withCookie(popupBody(issued.state),issued.cookie));
      expect(r.status).toBe(200);expect(await r.json()).toMatchObject({status:'connected'});
      expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    });
  });
  it('exposes only the server Graph version and a signed callback state to an admin',async()=>{
    const r=await config();expect(r.status).toBe(200);const body=await r.json();expect(body.graph_version).toBe('v26.0');
    expect(body.state).toMatch(/^[a-f0-9]{48}$/);expect(JSON.stringify(body)).not.toContain('test-secret');
    expect(r.headers.get('set-cookie')).toContain('HttpOnly');expect(r.headers.get('set-cookie')).toContain('Secure');
  });
  it('disconnect query error is not misreported as auth or not found',async () => {
    h.dbError=true;expect((await disconnectReq()).status).toBe(500);
  });
});

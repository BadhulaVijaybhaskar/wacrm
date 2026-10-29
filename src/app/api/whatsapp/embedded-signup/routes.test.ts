import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { POST as complete } from './complete/route';
import { GET as connections } from './connections/route';
import { POST as disconnect } from './connections/[id]/disconnect/route';
import { encryptToken } from '@/lib/whatsapp/embedded-signup/crypto';

const h = vi.hoisted(() => ({
  auth: vi.fn(), row: null as null | Record<string, unknown>, patches: [] as Record<string, unknown>[],
  failure: '' as string, owner: null as null | string, dbError: false,
}));
vi.mock('@/lib/auth/account', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/auth/account')>(),
  requireRole: () => h.auth(), getCurrentAccount: () => h.auth(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: () => ({ schema: (schema: string) => {
  expect(schema).toBe('wacrm');
  return {
    from: () => ({
      select: (fields: string) => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (key: string, value: unknown) => { filters[key] = value; return q; },
          order: async () => ({ data: h.row ? [h.row] : [], error: null }),
          maybeSingle: async () => ({
            data: fields === 'account_id' ? (h.owner ? {account_id:h.owner} : null)
              : h.row && filters.account_id === h.row.account_id ? h.row : null,
            error: h.dbError ? {code:'test'} : null,
          }),
        };
        return q;
      },
      update: (patch: Record<string, unknown>) => ({ eq: () => ({ eq: async () => {
        h.patches.push(patch); return {error:null};
      } }) }),
    }),
    rpc: async () => ({data:[{id:'connection',status:'pending',waba_id:'123'}],error:null}),
  };
} }) }));
const id = '12345678-1234-4234-8234-123456789012';
const req = (body: unknown = {code:'test-code',waba_id:'123',phone_number_id:'456'}) => new Request('https://test.invalid', {
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
});
const disconnectReq = () => disconnect(req(),{params:Promise.resolve({id})});
beforeEach(() => {
  vi.stubEnv('WACRM_EMBEDDED_SIGNUP','1'); vi.stubEnv('META_APP_ID','test-app'); vi.stubEnv('META_APP_SECRET','test-secret');
  vi.stubEnv('WACRM_TOKEN_ENC_KEY',Buffer.alloc(32,2).toString('base64'));
  h.auth.mockResolvedValue({accountId:'a',role:'admin'}); h.row=null; h.patches=[];h.failure='';h.owner=null;h.dbError=false;
  vi.stubGlobal('fetch',vi.fn(async (url: string) => {
    if(h.failure && url.includes(h.failure)) return Response.json({error:{code:100,message:'test-code test-token'}},{status:400});
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
    expect((await disconnectReq()).status).toBe(403);expect(fetch).not.toHaveBeenCalled();
  });
  it('returns 500 for unexpected failures',async () => {
    h.auth.mockRejectedValue(new Error('test-code test-token'));
    const r=await complete(req());expect(r.status).toBe(500);expect(await r.json()).toMatchObject({error:'internal_error'});
  });
  it.each([{},null,{code:'c',waba_id:'bad',phone_number_id:'456'},{code:'c',waba_id:'123',phone_number_id:'456',token:'x'}])('rejects invalid body %j with 400',async body => {
    const r=await complete(req(body));expect(r.status).toBe(400);expect(await r.json()).toMatchObject({error:'invalid_request'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns 400 for malformed JSON',async () => {
    expect((await complete(new Request('https://test.invalid',{method:'POST',body:'{'}))).status).toBe(400);
  });
  it('returns 404 on all three routes when flag is off before auth or side effects',async () => {
    vi.stubEnv('WACRM_EMBEDDED_SIGNUP','0');
    for(const r of [await complete(req()),await connections(),await disconnectReq()]) expect(r.status).toBe(404);
    expect(h.auth).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it('disconnect hides another accounts connection',async () => {
    h.row={id,account_id:'b',status:'connected'};
    const r=await disconnectReq();expect(r.status).toBe(404);expect(fetch).not.toHaveBeenCalled();expect(h.patches).toEqual([]);
  });
  it.each(['connected','error','pending'])('disconnect Meta failure on %s marks row error and returns 502',async status => {
    h.row={id,account_id:'a',status,waba_id:'123',token_ciphertext:encryptToken('test-token')};h.failure='/subscribed_apps';
    const r=await disconnectReq();expect(r.status).toBe(502);expect(await r.json()).toEqual({error:'meta_request_failed'});
    expect(h.patches).toEqual([expect.objectContaining({status:'error',last_error:'meta_request_failed'})]);
  });
  it('disconnect success unsubscribes and marks disconnected',async () => {
    h.row={id,account_id:'a',status:'connected',waba_id:'123',token_ciphertext:encryptToken('test-token')};
    const r=await disconnectReq();expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'disconnected'});
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/123/subscribed_apps'),expect.objectContaining({method:'DELETE'}));
    expect(h.patches).toEqual([expect.objectContaining({status:'disconnected',last_error:null})]);
  });
  it('disconnect query error is not misreported as auth or not found',async () => {
    h.dbError=true;expect((await disconnectReq()).status).toBe(500);
  });
});

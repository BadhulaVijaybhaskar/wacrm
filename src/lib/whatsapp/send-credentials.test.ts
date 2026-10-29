import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { encryptToken } from './embedded-signup/crypto';
import { encrypt,decrypt } from './encryption';
import { getSendCredentials,conversationPhoneNumber,loadSendConfig,SendCredentialError } from './send-credentials';
import { checkAccountConnections,tokenIsHealthy,markTokenError } from './embedded-signup/health';
import { postCloudApiMessages } from './meta-api';
import { loadTenantWhatsAppConfig } from '@/lib/astra-connect/after-call-templates';
import { toErrorResponse } from '@/lib/auth/account';
import { createServiceClient } from '@/lib/supabase/admin';
const h=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],legacy:null as null|Record<string,unknown>,calls:[] as {table:string;filters:Record<string,unknown>}[],writes:[] as Record<string,unknown>[],foreign:false,error:false,messageRows:[] as Record<string,unknown>[]}));
vi.mock('@/lib/supabase/admin',()=>({createServiceClient:()=>{
 const db={schema:(schema:string)=>{expect(schema).toBe('wacrm');return db;},from:(table:string)=>{
  const filters:Record<string,unknown>={};let patch:Record<string,unknown>|undefined;
  const result=()=>{
   h.calls.push({table,filters:{...filters}});
   let data=table==='wa_connections'?h.rows.filter(r=>h.foreign||Object.entries(filters).every(([k,v])=>r[k]===v)):table==='messages'?h.messageRows:[];
   if(patch){h.writes.push(patch);for(const row of data)Object.assign(row,patch);}
   return {data,error:h.error?{message:'private-db-details'}:null};
  };
  const q={select:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q;},order:()=>q,limit:()=>q,update:(value:Record<string,unknown>)=>{patch=value;return q;},
   maybeSingle:async()=>{h.calls.push({table,filters:{...filters}});return {data:table==='conversations'?{id:'conv'}:h.legacy,error:null};},
   then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};return q;
 }};return db;
}}));
function row(status='connected',account='a',token='business-token'){return {id:'connection',account_id:account,phone_number_id:'123',waba_id:'456',status,token_ciphertext:encryptToken(token)};}
beforeEach(()=>{
 vi.stubEnv('WACRM_EMBEDDED_SIGNUP','1');vi.stubEnv('META_APP_ID','app');vi.stubEnv('META_APP_SECRET','app-secret');
 vi.stubEnv('WACRM_TOKEN_ENC_KEY',Buffer.alloc(32,4).toString('base64'));
 h.rows=[];h.legacy={id:'legacy',account_id:'a',phone_number_id:'123',waba_id:'456',access_token:encrypt('legacy-token')};h.calls=[];h.writes=[];h.foreign=false;h.error=false;h.messageRows=[];
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{is_valid:true,app_id:'app',expires_at:0,scopes:['whatsapp_business_management','whatsapp_business_messaging']}})));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('Per-account WhatsApp credentials',()=>{
 it('uses a connected ES token for the exact account and number',async()=>{
  h.rows=[row()];expect(await getSendCredentials('a','123')).toMatchObject({source:'embedded',phoneNumberId:'123',accessToken:'business-token'});
  expect(h.calls[0]).toMatchObject({filters:{account_id:'a',phone_number_id:'123'}});
  expect(h.calls.some(c=>c.table==='whatsapp_config')).toBe(false);
 });
 it('uses unchanged legacy decryption when no ES row exists',async()=>{expect(await getSendCredentials('a','123')).toMatchObject({source:'legacy',accessToken:'legacy-token'});});
 it.each(['error','disconnected','pending'])('never falls back to legacy for a known %s ES phone',async status=>{
  h.rows=[row(status)];await expect(getSendCredentials('a','123')).rejects.toMatchObject({code:'whatsapp_reconnect_required'});
  expect(h.calls.some(c=>c.table==='whatsapp_config')).toBe(false);
 });
 it('rejects an unexpected row from another account instead of decrypting it',async()=>{
  h.foreign=true;h.rows=[row('connected','other','other-secret')];
  await expect(getSendCredentials('a','123')).rejects.toMatchObject({code:'credentials_lookup_failed'});
 });
 it('requires a number when more than one connected number exists',async()=>{
  h.rows=[row(),{...row(),id:'second',phone_number_id:'789'}];await expect(getSendCredentials('a')).rejects.toMatchObject({code:'whatsapp_number_required'});
 });
 it.each(['disconnected','error','pending'])('uses legacy when the only ES row is %s and no number is given',async status=>{
  h.rows=[row(status)];expect(await getSendCredentials('a')).toMatchObject({source:'legacy',accessToken:'legacy-token'});
 });
 it('uses legacy for a provenance-less conversation even with a connected ES number',async()=>{
  h.rows=[row()];h.messageRows=[];
  const config=await loadSendConfig(createServiceClient(),'a',undefined,'conv');
  expect(config.data.id).toBe('legacy');expect(decrypt(config.data.access_token)).toBe('legacy-token');
 });
 it('uses legacy for a conversation whose latest message has no provenance',async()=>{
  h.rows=[row()];h.messageRows=[{interactive_payload:{}}];
  const config=await loadSendConfig(createServiceClient(),'a',undefined,'conv');
  expect(config.data.id).toBe('legacy');
 });
 it('uses the connected ES number for a provenance-less conversation when no legacy exists',async()=>{
  h.rows=[row()];h.legacy=null;
  const config=await loadSendConfig(createServiceClient(),'a',undefined,'conv');
  expect(config.data.phone_number_id).toBe('123');expect(decrypt(config.data.access_token)).toBe('business-token');
 });
 it('throws the reconnect error when no legacy exists and the only ES row is in error',async()=>{
  h.rows=[row('error')];h.legacy=null;
  await expect(getSendCredentials('a')).rejects.toBeInstanceOf(SendCredentialError);
  await expect(getSendCredentials('a')).rejects.toMatchObject({code:'whatsapp_reconnect_required'});
 });
 it('still fails closed for an explicit number matching a non-connected ES row when legacy exists',async()=>{
  h.rows=[row('disconnected')];
  await expect(getSendCredentials('a','123')).rejects.toMatchObject({code:'whatsapp_reconnect_required'});
 });
 it('keeps flag-off legacy selection independent of ES rows',async()=>{
  vi.stubEnv('WACRM_EMBEDDED_SIGNUP','0');h.rows=[row('error')];expect(await getSendCredentials('a')).toMatchObject({source:'legacy'});
  expect(h.calls.some(c=>c.table==='wa_connections')).toBe(false);
 });
 it('does not fall back after an ES lookup error',async()=>{h.error=true;await expect(getSendCredentials('a','123')).rejects.toMatchObject({code:'credentials_lookup_failed'});});
 it('maps credential failures to a clear HTTP 409 reconnect response',async()=>{
  const response=toErrorResponse(new SendCredentialError());expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({error:'whatsapp_reconnect_required',message:expect.stringContaining('Reconnect WhatsApp')});
 });
 it('adapts ES credentials for existing senders without persisting the temporary envelope',async()=>{
  h.rows=[row()];const config=await loadSendConfig(createServiceClient(),'a','123');
  expect(config.data.phone_number_id).toBe('123');expect(decrypt(config.data.access_token)).toBe('business-token');expect(h.writes).toEqual([]);
 });
 it('uses the conversation source number instead of another connected account number',async()=>{
  h.rows=[row(),{...row(),id:'second',phone_number_id:'789',token_ciphertext:encryptToken('source-token')}];
  h.messageRows=[{interactive_payload:{_wacrm_phone_number_id:'789'}}];
  const config=await loadSendConfig(createServiceClient(),'a',undefined,'conv');
  expect(config.data.phone_number_id).toBe('789');expect(decrypt(config.data.access_token)).toBe('source-token');
 });
 it('fails closed for an inactive conversation source even when another number is connected',async()=>{
  h.rows=[row(),{...row('error'),id:'second',phone_number_id:'789'}];h.messageRows=[{interactive_payload:{_wacrm_phone_number_id:'789'}}];
  await expect(loadSendConfig(createServiceClient(),'a',undefined,'conv')).rejects.toMatchObject({code:'whatsapp_reconnect_required'});
 });
 it('uses explicitly quoted message provenance inside the account-owned conversation',async()=>{
  h.messageRows=[{interactive_payload:{_wacrm_phone_number_id:'123'}}];
  expect(await conversationPhoneNumber('a','conv','quoted-message')).toBe('123');
  expect(h.calls.find(c=>c.table==='messages')?.filters).toEqual({conversation_id:'conv',id:'quoted-message'});
 });
 it('uses ES credentials in after-call config lookup without changing tenant ownership checks',async()=>{
  h.rows=[row()];const result=await loadTenantWhatsAppConfig({db:createServiceClient(),accountId:'a',tenantId:'tenant',phoneNumberId:'123'});
  expect(result.ok).toBe(true);if(result.ok)expect(decrypt(result.config.access_token)).toBe('business-token');
 });
 it('scopes the source-number conversation lookup by account before reading message provenance',async()=>{
  await conversationPhoneNumber('a','conv');
  // No message in this fixture: older conversations intentionally return no provenance.
  expect(h.calls.find(c=>c.table==='conversations')?.filters).toEqual({id:'conv',account_id:'a'});
  const messages=h.calls.find(c=>c.table==='messages');expect(messages?.filters).toMatchObject({conversation_id:'conv',sender_type:'customer'});
 });
});
describe('Token health',()=>{
 it.each([
  {is_valid:false,app_id:'app'},
  {is_valid:true,app_id:'app',expires_at:1,scopes:['whatsapp_business_management','whatsapp_business_messaging']},
  {is_valid:true,app_id:'app',expires_at:0,scopes:['whatsapp_business_management']},
  {is_valid:true,app_id:'other-app',expires_at:0,scopes:['whatsapp_business_management','whatsapp_business_messaging']},
 ])('rejects invalid, expired, under-scoped or foreign-app debug data %j',data=>{expect(tokenIsHealthy(data)).toBe(false);});
 it('checks only account-scoped connected tokens using the server app access token',async()=>{
  h.rows=[row()];expect(await checkAccountConnections('a')).toEqual({connections:[{id:'connection',status:'connected'}]});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v26.0/debug_token?'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer app|app-secret'})}));
 });
 it('marks invalid tokens error with a safe reconnect message',async()=>{
  h.rows=[row()];vi.mocked(fetch).mockResolvedValue(Response.json({data:{is_valid:false,app_id:'app'}}));
  expect(await checkAccountConnections('a')).toEqual({connections:[{id:'connection',status:'error'}]});
  expect(h.writes[0]).toMatchObject({status:'error',last_error:expect.stringContaining('Reconnect WhatsApp')});
  expect(JSON.stringify(h.writes)).not.toContain('business-token');
 });
 it('does not mark an invalid token after it was rotated by reconnect',async()=>{
  h.rows=[row('connected','a','new-token')];await markTokenError('a','123','old-token',190);expect(h.writes).toEqual([]);
 });
 it('does not invalidate a token merely because debug_token had a network failure',async()=>{
  h.rows=[row()];vi.mocked(fetch).mockRejectedValue(new Error('network'));
  await expect(checkAccountConnections('a')).rejects.toMatchObject({code:'meta_request_failed'});expect(h.writes).toEqual([]);
 });
 it('turns Meta send auth error 190 into reconnect and marks only the matching account token',async()=>{
  h.rows=[row()];vi.mocked(fetch).mockResolvedValue(Response.json({error:{code:190,message:'private-token Authorization header'}},{status:401}));
  await expect(postCloudApiMessages({accountId:'a',phoneNumberId:'123',accessToken:'ignored',body:{},skipChannelGate:true})).rejects.toThrow('whatsapp_reconnect_required');
  expect(h.rows[0].status).toBe('error');expect(h.writes[0].last_error).toBe('Meta 190: WhatsApp authorization is invalid or expired. Reconnect WhatsApp.');
 });
});

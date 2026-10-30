import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/admin';
import { decryptToken, encryptToken } from './crypto';
import { sanitizeLastError } from './errors';

export const enabled = () => process.env.WACRM_EMBEDDED_SIGNUP === '1';
export const signupInput = z.object({
  code: z.string().min(1).max(4096),
  continuation: z.string().max(16384).optional(),
  waba_id: z.string().regex(/^\d{1,32}$/).optional(),
  phone_number_id: z.string().regex(/^\d{1,32}$/).optional(),
  mode: z.enum(['coexistence','standard']).optional(),
  state: z.string().max(256).optional(),
  source: z.enum(['popup','hosted']).optional(),
  business_id: z.string().regex(/^\d{1,32}$/).optional(),
}).strict();
export type SignupInput = z.infer<typeof signupInput>;

export class SignupError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly metaCode?: number) { super(code); }
}
export const publicError = (e: unknown) => e instanceof SignupError && e.code === 'pin_mismatch'
  ? { status: 409, body: { error: 'pin_mismatch', code: 'pin_mismatch', message: 'Turn off two-step verification for this number in WhatsApp Manager, then retry connecting.' } }
  : e instanceof SignupError && e.code === 'coexistence_required'
  ? { status: 409, body: { error: 'coexistence_required', code: 'coexistence_required', message: 'This number is active on the WhatsApp Business app. Connect it using coexistence.' } }
  : e instanceof SignupError
  ? { status: e.status, body: { error: e.code, message: 'WhatsApp connection could not be completed.' } }
  : { status: 500, body: { error: 'internal_error', message: 'WhatsApp connection could not be completed.' } };

export function graphVersion() {
  const version = process.env.META_GRAPH_VERSION || 'v26.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new SignupError('configuration_error', 503);
  return version;
}
export async function graph(path: string, token?: string, method = 'GET', data?: object) {
  const version = graphVersion();
  let response: Response;
  try { response = await fetch('https://graph.facebook.com/' + version + '/' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
    cache: 'no-store',
  });
  } catch { throw new SignupError('meta_request_failed', 502); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaCode = typeof body?.error?.code === 'number' ? body.error.code : undefined;
    throw new SignupError('meta_request_failed', 502, metaCode);
  }
  if (!body || (method !== 'GET' && body.success !== true && !(path.endsWith('/smb_app_data') && body.messaging_product === 'whatsapp' && typeof body.request_id === 'string'))) throw new SignupError('meta_request_failed', 502);
  return body;
}
// https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging-and-error-handling/
export async function inspectBusinessToken(token: string) {
  const appId=process.env.META_APP_ID;const secret=process.env.META_APP_SECRET?.split(',')[0]?.trim();
  if(!appId||!secret)throw new SignupError('configuration_error',503);
  const body=await graph('debug_token?'+new URLSearchParams({input_token:token}),appId+'|'+secret);
  return body.data;
}
export type PhoneChoice={id:string;display_phone_number:string|null;verified_name:string|null};
async function resolveAssets(input: SignupInput,token:string):Promise<{waba:string;phoneId:string|null;choices:PhoneChoice[]}> {
  let waba=input.waba_id;
  if(!waba){
    const data=await inspectBusinessToken(token);
    if(!data?.is_valid||String(data.app_id)!==process.env.META_APP_ID)throw new SignupError('asset_mismatch',403);
    const scopes=Array.isArray(data.granular_scopes)?data.granular_scopes:[];
    const ids=[...new Set<string>(scopes.filter((s:{scope?:string})=>s.scope==='whatsapp_business_management')
      .flatMap((s:{target_ids?:string[]})=>s.target_ids||[]).filter((id:unknown)=>typeof id==='string'&&/^\d+$/.test(id)))];
    if(ids.length!==1)throw new SignupError('asset_selection_required',400);
    waba=ids[0];
  }
  const assets=await graph(waba+'/phone_numbers?fields=id,display_phone_number,verified_name',token);
  if(!Array.isArray(assets.data))throw new SignupError('asset_mismatch',403);
  const ids=assets.data.map((p:{id?:string})=>p.id).filter((id:unknown)=>typeof id==='string');
  if(input.phone_number_id && !ids.includes(input.phone_number_id))throw new SignupError('asset_mismatch',403);
  // Popup FINISH can include a default number; still let the admin choose for multi-number WABAs.
  const phoneId=ids.length>1&&!input.continuation?null:input.phone_number_id || (ids.length===1?ids[0]:null);
  const choices:PhoneChoice[]=assets.data.filter((p:{id?:unknown})=>typeof p.id==='string').map((p:Record<string,unknown>)=>({
    id:String(p.id),display_phone_number:typeof p.display_phone_number==='string'?p.display_phone_number:null,
    verified_name:typeof p.verified_name==='string'?p.verified_name:null,
  }));
  if(!phoneId && !choices.length)throw new SignupError('asset_selection_required',400);
  return {waba,phoneId,choices};
}
// Meta: the one-time Business app data sync was already performed for this number.
const ALREADY_SYNCED_META_CODE = 2593107;
export async function connect(input: SignupInput, accountId: string) {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET?.split(',')[0]?.trim();
  if (!appId || !secret) throw new SignupError('configuration_error', 503);
  let token:string;
  if(input.continuation){
    try{
      const saved=JSON.parse(decryptToken(input.continuation));
      if(saved.kind!=='number_selection' || saved.accountId!==accountId || typeof saved.expires!=='number' || saved.expires<=Date.now() || typeof saved.token!=='string'
        || saved.waba!==input.waba_id || saved.mode!==input.mode || saved.businessId!==input.business_id || saved.state!==input.state || saved.source!==input.source)
        throw new Error('invalid');
      token=saved.token;
    }catch{throw new SignupError('invalid_continuation',403);}
  }else{
    const params = new URLSearchParams({ client_id: appId, client_secret: secret, code: input.code });
    const exchange = await graph('oauth/access_token?' + params.toString());
    if (typeof exchange.access_token !== 'string' || !exchange.access_token) throw new SignupError('exchange_failed', 502);
    token=exchange.access_token;
  }
  const {waba,phoneId,choices}=await resolveAssets(input,token);
  if(!phoneId)return {status:'selection_required',waba_id:waba,choices,
    continuation:encryptToken(JSON.stringify({kind:'number_selection',accountId,token,waba,source:input.source,mode:input.mode,businessId:input.business_id,state:input.state,expires:Date.now()+600000}))};
  const phone = await graph(phoneId + '?fields=display_phone_number,verified_name,quality_rating,is_on_biz_app,platform_type', token);
  const mode=input.mode || (input.source==='hosted' && phone.is_on_biz_app===true?'coexistence':'standard');
  if(mode==='coexistence' && (phone.is_on_biz_app!==true || phone.platform_type!=='CLOUD_API'))
    throw new SignupError('asset_mismatch',403);
  // A number still active on the Business app must onboard via coexistence;
  // registering it would take it off the app.
  if(mode==='standard' && phone.is_on_biz_app===true)
    throw new SignupError('coexistence_required',409);
  const service = createServiceClient().schema('wacrm');
  // Existing legacy ownership is still authoritative during the mixed rollout.
  const { data: legacyOwners, error: legacyError } = await service.from('whatsapp_config')
    .select('account_id').eq('phone_number_id', phoneId).neq('account_id', accountId).limit(1);
  if (legacyError || !legacyOwners) throw new SignupError('database_error', 500);
  if (legacyOwners.length > 0) throw new SignupError('number_in_use_legacy', 409);
  // This fast rejection is backed by the atomic claim below (the race arbiter).
  const { data: owner, error: ownershipError } = await service.from('wa_connections')
    .select('account_id,status,updated_at').eq('phone_number_id', phoneId).maybeSingle();
  if (ownershipError) throw new SignupError('database_error', 500);
  const recoverable = owner && (owner.status === 'disconnected' || owner.status === 'error'
    || (owner.status === 'pending' && Date.parse(owner.updated_at) < Date.now() - 15 * 60 * 1000));
  if (owner && owner.account_id !== accountId && !recoverable)
    throw new SignupError('phone_in_use', 409);
  // Read a saved PIN only through an account-scoped lookup. A takeover must
  // neither load/decrypt another account's ciphertext nor register with its PIN.
  let savedPin: string | null = null;
  if (mode==='standard' && owner?.account_id === accountId) {
    const { data: own, error: pinError } = await service.from('wa_connections')
      .select('pin_ciphertext').eq('phone_number_id', phoneId)
      .eq('account_id', accountId).maybeSingle();
    if (pinError) throw new SignupError('database_error', 500);
    savedPin = own?.pin_ciphertext || null;
  }
  const pin = mode==='coexistence'?null:savedPin ? decryptToken(savedPin) : String(randomInt(0, 1000000)).padStart(6, '0');
  const { data, error } = await service.rpc('claim_wa_connection', {
    p_account_id: accountId, p_waba_id: waba, p_phone_number_id: phoneId,
    p_business_id: input.business_id || null,
    p_display_phone_number: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : null,
    p_verified_name: typeof phone.verified_name === 'string' ? phone.verified_name : null,
    p_quality_rating: typeof phone.quality_rating === 'string' ? phone.quality_rating : null,
    p_token_ciphertext: encryptToken(token), p_pin_ciphertext: pin ? encryptToken(pin) : null,
  });
  if (error) {
    if (error.code === '23505' || error.message?.includes('wa_connection_owned')) throw new SignupError('phone_in_use', 409);
    throw new SignupError('database_error', 500);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new SignupError('database_error', 500);
  const wasConnected = result.status === 'connected';
  // This is the POST-upsert stored token, not necessarily the former token.
  // Only connected claims preserve the former value; use it solely to restore
  // that same account's live connection on failure. It is never a token to revoke.
  if (wasConnected && typeof result.stored_token_ciphertext !== 'string')
    throw new SignupError('database_error', 500);
  // Use the atomically claimed PIN rather than a potentially stale pre-check.
  const registrationPin = mode==='coexistence'?null:result.claimed_pin_ciphertext ? decryptToken(result.claimed_pin_ciphertext) : pin;
  const update = async (status: string, last_error: string | null, fields: Record<string, unknown> = {}) => {
    const { data: updated, error: updateError } = await service.from('wa_connections')
      .update({ ...fields, status, last_error, updated_at: new Date().toISOString() })
      .eq('account_id', accountId).eq('id', result.id)
      .eq('status', wasConnected ? 'connected' : 'pending').select('id');
    if (updateError) throw new SignupError('database_error', 500);
    if (!updated || updated.length === 0) throw new SignupError('state_changed', 409);
  };
  console.info('[embedded-signup] onboarding mode',mode);
  try {
    try {
      if(mode==='standard')await graph(phoneId + '/register', token, 'POST', { messaging_product: 'whatsapp', pin: registrationPin });
    } catch (error) {
      // Meta Cloud API error reference: 133005 = two-step verification PIN incorrect.
      // https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
      if (error instanceof SignupError && error.metaCode === 133005)
        throw new SignupError('pin_mismatch', 409, 133005);
      throw error;
    }
    await graph(waba + '/subscribed_apps', token, 'POST');
    // A previously connected coexistence row was already synced. A connected
    // standard row (it still holds a PIN) switching to coexistence was not.
    const switchedFromStandard=wasConnected && typeof result.claimed_pin_ciphertext==='string';
    if(mode==='coexistence' && (!wasConnected || switchedFromStandard)){
      // Registration is forbidden for coexistence. Both documented one-time
      // sync requests must start within 24h, after WABA subscription.
      // https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#synchronizing-whatsapp-business-app-data
      for(const sync_type of ['smb_app_state_sync','history']){
        try{
          const sync=await graph(phoneId+'/smb_app_data',token,'POST',{messaging_product:'whatsapp',sync_type});
          console.info('[embedded-signup] sync accepted',sync_type,
            typeof sync.request_id==='string'&&/^[\w-]{1,128}$/.test(sync.request_id)?sync.request_id:'unavailable');
        }catch(syncError){
          if(!(syncError instanceof SignupError && syncError.metaCode===ALREADY_SYNCED_META_CODE))throw syncError;
          console.info('[embedded-signup] sync already performed',sync_type,syncError.metaCode);
        }
      }
    }
    await update('connected', null, {
      token_ciphertext: encryptToken(token), waba_id: waba,
      business_id: input.business_id || null,
      ...(mode==='coexistence'?{pin_ciphertext:null}:{}),
      display_phone_number: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : null,
      verified_name: typeof phone.verified_name === 'string' ? phone.verified_name : null,
      quality_rating: typeof phone.quality_rating === 'string' ? phone.quality_rating : null,
    });
  } catch (error) {
    // A concurrent disconnect/transfer wins. Do not restore over its state.
    if (error instanceof SignupError && error.code === 'state_changed') throw error;
    try {
      await update(wasConnected ? 'connected' : 'error', sanitizeLastError(error instanceof SignupError ? error.code : undefined, error instanceof SignupError ? error.metaCode : undefined),
        wasConnected ? { token_ciphertext: result.stored_token_ciphertext } : {});
    } catch (restoreError) {
      if (restoreError instanceof SignupError && restoreError.code === 'state_changed') throw restoreError;
      // Preserve the original Meta error if recording/restoring state fails.
    }
    throw error instanceof SignupError ? error : new SignupError('meta_request_failed', 502);
  }
  // Explicit allowlist: even an unexpected RPC response cannot leak ciphertext.
  return {
    id: result.id, display_phone_number: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : null,
    verified_name: typeof phone.verified_name === 'string' ? phone.verified_name : null,
    quality_rating: typeof phone.quality_rating === 'string' ? phone.quality_rating : null,
    waba_id: waba, status: 'connected',
  };
}
export async function unsubscribe(waba: string, token: string) {
  await graph(waba + '/subscribed_apps', token, 'DELETE');
}

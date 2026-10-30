import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
let warnedMissingStateSecret = false;
/** Server-side only; the legacy key is the first configured Meta app secret. */
export function callbackStateSecret() {
  const dedicated = process.env.WACRM_ES_STATE_SECRET;
  if (dedicated) return dedicated;
  if (!warnedMissingStateSecret) {
    console.warn('[embedded-signup] WACRM_ES_STATE_SECRET is not set; falling back to META_APP_SECRET');
    warnedMissingStateSecret = true;
  }
  return process.env.META_APP_SECRET?.split(',')[0]?.trim() || '';
}
export const CALLBACK_COOKIE='wacrm_signup_state';
export function issueCallbackState(accountId:string,secret:string,now=Date.now()){
  const state=randomBytes(24).toString('hex');
  const payload=Buffer.from(JSON.stringify({state,accountId,expires:now+600000})).toString('base64url');
  const signature=createHmac('sha256',secret).update(payload).digest('hex');
  return {state,cookie:payload+'.'+signature};
}
export function validCallbackState(state:unknown,cookie:string|undefined,accountId:string,secret:string,now=Date.now()){
  if(typeof state!=='string'||!cookie||!secret)return false;
  const [payload,signature,...extra]=cookie.split('.');
  if(extra.length||!payload||!signature||!/^[a-f0-9]{64}$/.test(signature))return false;
  const expected=createHmac('sha256',secret).update(payload).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return false;
  try{const d=JSON.parse(Buffer.from(payload,'base64url').toString());return d.accountId===accountId&&d.state===state&&typeof d.expires==='number'&&d.expires>now;}
  catch{return false;}
}

import { createServiceClient } from '@/lib/supabase/admin';
import { decryptToken } from './crypto';
import { inspectBusinessToken, SignupError } from './core';
import { sanitizeLastError } from './errors';
export function tokenIsHealthy(data: unknown, now=Math.floor(Date.now()/1000)): boolean {
  if(!data||typeof data!=='object')return false;
  const d=data as {is_valid?:boolean;app_id?:string;expires_at?:number;data_access_expires_at?:number;scopes?:string[]};
  return d.is_valid===true && String(d.app_id)===process.env.META_APP_ID
    && [d.expires_at,d.data_access_expires_at].every(t=>t===undefined||(typeof t==='number'&&Number.isFinite(t)&&(t===0||t>now)))
    && ['whatsapp_business_management','whatsapp_business_messaging'].every(s=>Array.isArray(d.scopes)&&d.scopes.includes(s));
}
export async function markTokenError(accountId:string,phoneNumberId:string,token:string,metaCode?:number){
  const db=createServiceClient().schema('wacrm');
  const {data,error}=await db.from('wa_connections').select('id,token_ciphertext')
    .eq('account_id',accountId).eq('phone_number_id',phoneNumberId).eq('status','connected');
  if(error)throw new SignupError('database_error',500);
  for(const row of data||[]){
    // A delayed 190 must not invalidate a token replaced by a successful reconnect.
    let same=false;try{same=decryptToken(row.token_ciphertext)===token;}catch{same=true;}
    if(!same)continue;
    const {error:writeError}=await db.from('wa_connections').update({status:'error',last_error:sanitizeLastError('token_invalid',metaCode)})
      .eq('account_id',accountId).eq('id',row.id).eq('token_ciphertext',row.token_ciphertext).eq('status','connected');
    if(writeError)throw new SignupError('database_error',500);
  }
}
export async function checkAccountConnections(accountId:string){
  const db=createServiceClient().schema('wacrm');
  const {data,error}=await db.from('wa_connections').select('id,phone_number_id,token_ciphertext')
    .eq('account_id',accountId).eq('status','connected');
  if(error)throw new SignupError('database_error',500);
  const results=[];
  for(const row of data||[]){
    let token:string;
    try{token=decryptToken(row.token_ciphertext);}catch{throw new SignupError('configuration_error',503);}
    // A transient network failure is not evidence that a business token is invalid.
    const healthy=tokenIsHealthy(await inspectBusinessToken(token));
    if(!healthy)await markTokenError(accountId,row.phone_number_id,token);
    else {
      // Bumping updated_at rotates the oldest-first scheduled scan.
      const {error:writeError}=await db.from('wa_connections').update({last_error:null,updated_at:new Date().toISOString()})
        .eq('account_id',accountId).eq('id',row.id).eq('token_ciphertext',row.token_ciphertext).eq('status','connected');
      if(writeError)throw new SignupError('database_error',500);
    }
    results.push({id:row.id,status:healthy?'connected':'error'});
  }
  return {connections:results};
}

// Moves a failing account to the back of the oldest-first scan without touching status or last_error.
async function deferAccount(accountId:string){
  try{
    await createServiceClient().schema('wacrm').from('wa_connections').update({updated_at:new Date().toISOString()})
      .eq('account_id',accountId).eq('status','connected');
  }catch{
    // Best effort: a failed bump must not affect the rest of the batch.
  }
}

// Reuses the existing authenticated automation cron; no new scheduler/infra.
export async function checkScheduledConnections(options:{signal?:AbortSignal}={}){
  const {signal}=options;
  const {data,error}=await createServiceClient().schema('wacrm').from('wa_connections')
    .select('account_id').eq('status','connected').order('updated_at',{ascending:true}).limit(50);
  if(error)throw new SignupError('database_error',500);
  for(const accountId of [...new Set<string>((data||[]).map((r:{account_id:string})=>r.account_id))]){
    if(signal?.aborted)return;
    try{
      await checkAccountConnections(accountId);
    }catch(accountError){
      // One failing account (network, timeout, database) must not stop the batch,
      // and never flips the row to error: only a definitive invalid token does.
      console.warn('[embedded-signup] account health check failed',accountError instanceof SignupError?accountError.code:'unexpected_error');
      await deferAccount(accountId);
    }
  }
}

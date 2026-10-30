import { createServiceClient } from '@/lib/supabase/admin';
import { decryptToken } from './crypto';
import { inspectBusinessToken, SignupError } from './core';
import { sanitizeLastError } from './errors';
type Rotation={legacy:boolean};
let warnedMissingColumn=false;
function missingHealthColumn(error:{code?:string;message?:string}|null){
  return !!error && (['42703','PGRST204'].includes(error.code||'') || !!error.message?.includes('last_health_check_at'));
}
function switchToLegacyRotation(rotation:Rotation){
  rotation.legacy=true;
  if(!warnedMissingColumn){console.warn('[embedded-signup] last_health_check_at unavailable; using updated_at rotation');warnedMissingColumn=true;}
}
async function stamp(accountId:string,id:string|undefined,rotation:Rotation,fields:Record<string,unknown>={},tokenCiphertext?:string){
  const write=()=>{
    let q=createServiceClient().schema('wacrm').from('wa_connections')
      .update({...fields,[rotation.legacy?'updated_at':'last_health_check_at']:new Date().toISOString()})
      .eq('account_id',accountId).eq('status','connected');
    if(tokenCiphertext)q=q.eq('token_ciphertext',tokenCiphertext);
    if(id)q=q.eq('id',id);
    return q;
  };
  let result=await write();
  if(!rotation.legacy && missingHealthColumn(result.error)){switchToLegacyRotation(rotation);result=await write();}
  return result;
}
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
export async function checkAccountConnections(accountId:string,rotation:Rotation={legacy:false}){
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
    if(!healthy){
      const {error:stampError}=await stamp(accountId,row.id,rotation,{},row.token_ciphertext);
      if(stampError)throw new SignupError('database_error',500);
      await markTokenError(accountId,row.phone_number_id,token);
    }
    else {
      const {error:writeError}=await stamp(accountId,row.id,rotation,{last_error:null},row.token_ciphertext);
      if(writeError)throw new SignupError('database_error',500);
    }
    results.push({id:row.id,status:healthy?'connected':'error'});
  }
  return {connections:results};
}

// Moves a failing account to the back of the oldest-first scan without touching status or last_error.
async function deferAccount(accountId:string,rotation:Rotation){
  try{
    const {error}=await stamp(accountId,undefined,rotation);
    if(error)console.warn('[embedded-signup] health check deferral failed');
  }catch{
    console.warn('[embedded-signup] health check deferral failed');
  }
}

// Reuses the existing authenticated automation cron; no new scheduler/infra.
export async function checkScheduledConnections(options:{signal?:AbortSignal}={}){
  const {signal}=options;
  const rotation:Rotation={legacy:false};
  const scan=()=>createServiceClient().schema('wacrm').from('wa_connections')
    .select('account_id').eq('status','connected')
    .order(rotation.legacy?'updated_at':'last_health_check_at',{ascending:true,nullsFirst:true}).limit(50);
  let {data,error}=await scan();
  if(missingHealthColumn(error)){switchToLegacyRotation(rotation);({data,error}=await scan());}
  if(error)throw new SignupError('database_error',500);
  for(const accountId of [...new Set<string>((data||[]).map((r:{account_id:string})=>r.account_id))]){
    if(signal?.aborted)return;
    try{
      await checkAccountConnections(accountId,rotation);
    }catch(accountError){
      // One failing account (network, timeout, database) must not stop the batch,
      // and never flips the row to error: only a definitive invalid token does.
      console.warn('[embedded-signup] account health check failed',accountError instanceof SignupError?accountError.code:'unexpected_error');
      await deferAccount(accountId,rotation);
    }
  }
}

import { createServiceClient } from '@/lib/supabase/admin';
import { decrypt, encrypt } from './encryption';
import { decryptToken } from './embedded-signup/crypto';
import { enabled } from './embedded-signup/core';

export class SendCredentialError extends Error {
  readonly status=409;
  constructor(public readonly code='whatsapp_reconnect_required'){super(code);}
}
// Runtime schema clients and existing engine adapters intentionally use loose SDK generics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SendDb = {from:(table:string)=>any};
export async function getSendCredentials(accountId:string,phoneNumberId?:string,options?:{db?:SendDb}) {
  if(!accountId)throw new SendCredentialError('account_required');
  const legacyDb=options?.db || createServiceClient();
  if(enabled()){
    let query=createServiceClient().schema('wacrm').from('wa_connections')
      .select('id,account_id,phone_number_id,waba_id,status,token_ciphertext').eq('account_id',accountId);
    if(phoneNumberId)query=query.eq('phone_number_id',phoneNumberId);
    const {data,error}=await query;
    if(error)throw new SendCredentialError('credentials_lookup_failed');
    if((data||[]).some((r:{account_id:string})=>r.account_id!==accountId))throw new SendCredentialError('credentials_lookup_failed');
    let rows=(data||[]).filter((r:{account_id:string;phone_number_id:string})=>r.account_id===accountId&&(!phoneNumberId||r.phone_number_id===phoneNumberId));
    if(rows.length){
      if(!phoneNumberId){const connected=rows.filter((r:{status:string})=>r.status==='connected');if(connected.length)rows=connected;}
      if(rows.length!==1)throw new SendCredentialError('whatsapp_number_required');
      if(rows[0].status!=='connected')throw new SendCredentialError();
      try{return {source:'embedded' as const,id:rows[0].id,accountId,phoneNumberId:rows[0].phone_number_id,wabaId:rows[0].waba_id,accessToken:decryptToken(rows[0].token_ciphertext)};}
      catch{throw new SendCredentialError();}
    }
  }
  const {data:legacy,error}=await legacyDb.from('whatsapp_config').select('*').eq('account_id',accountId).maybeSingle();
  if(error)throw new SendCredentialError('credentials_lookup_failed');
  if(!legacy || legacy.account_id && legacy.account_id!==accountId)return null;
  if(phoneNumberId&&legacy.phone_number_id!==phoneNumberId)throw new SendCredentialError('whatsapp_number_not_found');
  return {source:'legacy' as const,id:legacy.id,accountId,phoneNumberId:legacy.phone_number_id,wabaId:legacy.waba_id,accessToken:decrypt(legacy.access_token),legacy};
}

export async function conversationPhoneNumber(accountId:string,conversationId:string,replyToMessageId?:string):Promise<string|undefined>{
  const db=createServiceClient().schema('wacrm');
  const {data:conversation,error}=await db.from('conversations').select('id').eq('id',conversationId).eq('account_id',accountId).maybeSingle();
  if(error||!conversation)throw new SendCredentialError('conversation_not_found');
  // Existing JSONB payload keeps routing durable without editing applied SQL.
  let query=db.from('messages').select('interactive_payload').eq('conversation_id',conversationId);
  query=replyToMessageId?query.eq('id',replyToMessageId):query.eq('sender_type','customer');
  const {data:messages,error:messageError}=await query.order('created_at',{ascending:false}).limit(1);
  if(messageError)throw new SendCredentialError('credentials_lookup_failed');
  const value=messages?.[0]?.interactive_payload?._wacrm_phone_number_id;
  return typeof value==='string'?value:undefined;
}

// Keep callers' legacy code paths completely unchanged while the flag is off.
export async function loadSendConfig(db:SendDb,accountId:string,phoneNumberId?:string,conversationId?:string,maybeSingle=false,replyToMessageId?:string){
  if(!enabled()){
    const q=db.from('whatsapp_config').select('*').eq('account_id',accountId);
    return maybeSingle?q.maybeSingle():q.single();
  }
  const phone=phoneNumberId || (conversationId?await conversationPhoneNumber(accountId,conversationId,replyToMessageId):undefined);
  const credentials=await getSendCredentials(accountId,phone,{db});
  if(!credentials)return {data:null,error:null};
  if(credentials.source==='legacy')return {data:credentials.legacy,error:null};
  // Adapter for older senders: transient legacy-format encryption, never persisted.
  // This lets all existing decrypt/error/idempotency paths stay intact.
  return {data:{id:credentials.id,account_id:accountId,
    phone_number_id:credentials.phoneNumberId,waba_id:credentials.wabaId,status:'connected',access_token:encrypt(credentials.accessToken)},error:null};
}

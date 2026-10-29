// Documented payloads only; historical/Business-app messages never run bots.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users#webhooks
import { z } from 'zod';
const message=z.object({id:z.string(),timestamp:z.string().regex(/^\d+$/),type:z.string(),from:z.string().optional(),to:z.string().optional(),
  text:z.object({body:z.string()}).optional(),history_context:z.object({status:z.string().optional()}).optional()}).passthrough();
const history=z.object({history:z.array(z.object({threads:z.array(z.object({id:z.string(),messages:z.array(message)})).optional()}))});
const echoes=z.object({message_echoes:z.array(message)});
const contacts=z.object({state_sync:z.array(z.object({type:z.string(),action:z.string(),contact:z.object({phone_number:z.string(),full_name:z.string().optional(),first_name:z.string().optional()})}))});
export type SyncMessage=z.infer<typeof message>;
export type SyncHooks={contact:(phone:string,name?:string)=>Promise<string|null>;save:(contactId:string,messages:SyncMessage[],outbound:boolean)=>Promise<void>};
export async function ingestCoexistence(field:string,value:unknown,hooks:SyncHooks):Promise<boolean>{
  if(field==='smb_app_state_sync'){
    const data=contacts.safeParse(value);if(!data.success)return true;
    for(const row of data.data.state_sync)if(row.type==='contact'&&row.action==='add')await hooks.contact(row.contact.phone_number,row.contact.full_name||row.contact.first_name);
    // App-address-book removal must not delete a CRM contact or its history.
    return true;
  }
  if(field==='smb_message_echoes'){
    const data=echoes.safeParse(value);if(!data.success)return true;
    for(const msg of data.data.message_echoes){if(!msg.to)continue;const id=await hooks.contact(msg.to);if(id)await hooks.save(id,[msg],true);}
    return true;
  }
  if(field==='history'){
    const data=history.safeParse(value);if(!data.success)return true; // Includes documented history-sharing-declined errors.
    for(const chunk of data.data.history)for(const thread of chunk.threads||[]){
      const id=await hooks.contact(thread.id);if(!id)continue;
      const incoming=thread.messages.filter(m=>!m.to),outgoing=thread.messages.filter(m=>!!m.to);
      for(const [messages,outbound] of [[incoming,false],[outgoing,true]] as const)
        for(let i=0;i<messages.length;i+=200)await hooks.save(id,messages.slice(i,i+200),outbound);
    }
    return true;
  }
  return false;
}

import {describe,it,expect,vi} from 'vitest';
import {ingestCoexistence} from './coexistence';
describe('Documented coexistence sync payloads',()=>{
 it('imports added contacts but never deletes CRM contacts on an app removal',async()=>{
  const contact=vi.fn(async()=> 'contact');const save=vi.fn();
  await ingestCoexistence('smb_app_state_sync',{state_sync:[{type:'contact',action:'add',contact:{phone_number:'123',full_name:'Test'}},{type:'contact',action:'remove',contact:{phone_number:'456'}}]},{contact,save});
  expect(contact).toHaveBeenCalledOnce();expect(contact).toHaveBeenCalledWith('123','Test');expect(save).not.toHaveBeenCalled();
 });
 it('separates history direction and saves batches without invoking any bot sender',async()=>{
  const contact=vi.fn(async()=> 'contact');const save=vi.fn();
  const incoming={id:'m1',from:'123',timestamp:'1700000000',type:'text',text:{body:'hello'}};
  const outgoing={...incoming,id:'m2',to:'123'};
  await ingestCoexistence('history',{history:[{threads:[{id:'123',messages:[incoming,outgoing]}]}]},{contact,save});
  expect(save.mock.calls).toEqual([['contact',[incoming],false],['contact',[outgoing],true]]);
 });
 it('imports Business app outbound echoes as outbound, not customer messages',async()=>{
  const contact=vi.fn(async()=> 'contact');const save=vi.fn();
  await ingestCoexistence('smb_message_echoes',{message_echoes:[{id:'m',timestamp:'1700000000',type:'text',to:'123',text:{body:'app reply'}}]},{contact,save});
  expect(contact).toHaveBeenCalledWith('123');expect(save).toHaveBeenCalledWith('contact',expect.any(Array),true);
 });
 it('handles the documented declined-history/error case without importing bogus messages',async()=>{
  const contact=vi.fn();const save=vi.fn();expect(await ingestCoexistence('history',{history:[{errors:[{code:2593109}]}]},{contact,save})).toBe(true);expect(save).not.toHaveBeenCalled();
 });
});

import {updateSyncPreview,type SyncMessage} from './coexistence';
import type {SupabaseClient} from '@supabase/supabase-js';
describe('coexistence conversation previews',()=>{
 function database(current:string|null){
  const snapshot={last_message_at:current,last_message_text:'newer preview'};
  const filters:Record<string,unknown>={};
  const update=vi.fn((patch:typeof snapshot)=>{
   const q={eq:(key:string,value:unknown)=>{filters[key]=value;return q;},or:vi.fn(async(predicate:string)=>{
    expect(predicate).toBe(`last_message_at.is.null,last_message_at.lt."${patch.last_message_at}"`);
    if(!snapshot.last_message_at||Date.parse(snapshot.last_message_at)<Date.parse(patch.last_message_at!))Object.assign(snapshot,patch);
    return {error:null};
   })};return q;
  });
  return {db:{from:vi.fn(()=>({update}))} as unknown as SupabaseClient,snapshot,filters,update};
 }
 const msg={id:'echo',timestamp:'1700000000',type:'text',to:'123',text:{body:'app reply'}};
 it('updates preview and timestamp for a newer echo, scoped to account and conversation',async()=>{
  const h=database('2020-01-01T00:00:00Z');
  await ingestCoexistence('smb_message_echoes',{message_echoes:[msg]}, {contact:async()=> 'contact',save:async(_id,messages)=>updateSyncPreview(h.db,'account','conversation',messages)});
  expect(h.snapshot).toEqual({last_message_text:'app reply',last_message_at:new Date(1700000000000).toISOString()});
  expect(h.filters).toEqual({account_id:'account',id:'conversation'});
  expect(h.update.mock.results[0].value.or).toHaveBeenCalledWith('last_message_at.is.null,last_message_at.lt."2023-11-14T22:13:20.000Z"');
 });
 it('does not overwrite a newer preview with older history',async()=>{
  const h=database('2026-01-01T00:00:00Z');
  await ingestCoexistence('history',{history:[{threads:[{id:'123',messages:[msg]}]}]}, {contact:async()=> 'contact',save:async(_id,messages)=>updateSyncPreview(h.db,'account','conversation',messages)});
  expect(h.snapshot.last_message_text).toBe('newer preview');
 });
 it('keeps the preview at equal timestamps and fills an unset timestamp',async()=>{
  const equal=database(new Date(1700000000000).toISOString());
  await updateSyncPreview(equal.db,'a','c',[msg]);expect(equal.snapshot.last_message_text).toBe('newer preview');
  const empty=database(null);await updateSyncPreview(empty.db,'a','c',[{...msg,type:'image',text:undefined}]);
  expect(empty.snapshot.last_message_text).toBe('[image]');
 });
 it('ignores missing, zero or out-of-range message timestamps',async()=>{
  const h=database(null);
  for(const timestamp of [undefined,'','0','999999999999999999999999999'])await updateSyncPreview(h.db,'a','c',[{...msg,timestamp} as unknown as SyncMessage]);
  expect(h.update).not.toHaveBeenCalled();
 });
});

it('ignores a webhook message without a timestamp rather than inventing a new preview time',async()=>{
 const contact=vi.fn(async()=> 'contact');const save=vi.fn();
 await ingestCoexistence('smb_message_echoes',{message_echoes:[{id:'missing',type:'text',to:'123',text:{body:'undated'}}]},{contact,save});
 expect(save).not.toHaveBeenCalled();
});

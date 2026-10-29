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

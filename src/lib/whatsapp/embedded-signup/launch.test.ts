import {describe,it,expect,vi} from 'vitest';
import {launchOptions,consumeSettingsCallback,signupMessage} from './launch';
import {graphVersion} from './core';
describe('Embedded Signup v4 launch and settings callback',()=>{
 it('launches coexistence with v4 and the documented featureType',()=>{
  expect(launchOptions('one-config','coexistence')).toMatchObject({config_id:'one-config',extras:{version:'v4',sessionInfoVersion:'3',setup:{},featureType:'whatsapp_business_app_onboarding'}});
 });
 it('uses the same config for standard mode and omits featureType entirely',()=>{const options=launchOptions('one-config','standard');expect(options.config_id).toBe('one-config');expect(options.extras).not.toHaveProperty('featureType');});
 it('defaults the server Graph version to v26.0 and honors META_GRAPH_VERSION',()=>{
  vi.stubEnv('META_GRAPH_VERSION','');expect(graphVersion()).toBe('v26.0');vi.stubEnv('META_GRAPH_VERSION','v27.0');expect(graphVersion()).toBe('v27.0');vi.unstubAllEnvs();
 });
 it('consumes callback once and removes code/state before the request can start',()=>{
  let url='https://test.invalid/settings?code=private-code&waba_id=123&phone_number_id=456&state=private-state';
  const replace=vi.fn((path:string)=>{url=new URL(path,url).href;});
  expect(consumeSettingsCallback(url,true,true,replace)).toEqual({kind:'complete',payload:{code:'private-code',waba_id:'123',phone_number_id:'456',state:'private-state',source:'hosted'}});
  expect(url).not.toMatch(/private-code|private-state|code=|state=/);expect(consumeSettingsCallback(url,true,true,replace)).toEqual({kind:'ignored'});expect(replace).toHaveBeenCalledTimes(1);
 });
 it('accepts the documented coexistence finish event with no phone ID and strips unrelated asset fields',()=>{
  expect(signupMessage('https://www.facebook.com',{type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'123',access_token:'must-not-forward'}})).toEqual({kind:'finish',assets:{waba_id:'123',phone_number_id:undefined,business_id:undefined,mode:'coexistence'}});
  expect(signupMessage('https://facebook.com.attacker.invalid',{})).toBeNull();expect(signupMessage('http://facebook.com',{})).toBeNull();
 });
 it('ignores callback entirely with flag off',()=>{const replace=vi.fn();expect(consumeSettingsCallback('https://test.invalid/settings?code=c',false,true,replace)).toEqual({kind:'ignored'});expect(replace).not.toHaveBeenCalled();});
 it('rejects a non-admin without submitting the code',()=>{const replace=vi.fn();expect(consumeSettingsCallback('https://test.invalid/settings?code=c',true,false,replace)).toEqual({kind:'forbidden'});expect(replace).toHaveBeenCalledOnce();});
});

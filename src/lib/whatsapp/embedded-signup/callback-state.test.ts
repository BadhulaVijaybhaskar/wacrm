import {describe,it,expect,vi,afterEach} from 'vitest';
import {issueCallbackState,validCallbackState} from './callback-state';
describe('Authenticated settings OAuth state',()=>{
 it('binds callback state to the initiating account and a short-lived signed cookie',()=>{
  const issued=issueCallbackState('a','test-secret',1000);
  expect(validCallbackState(issued.state,issued.cookie,'a','test-secret',1001)).toBe(true);
  expect(validCallbackState(issued.state,issued.cookie,'other','test-secret',1001)).toBe(false);
  expect(validCallbackState(issued.state,issued.cookie,'a','test-secret',601001)).toBe(false);
  expect(validCallbackState('wrong',issued.cookie,'a','test-secret',1001)).toBe(false);
  expect(validCallbackState(issued.state,issued.cookie+'0','a','test-secret',1001)).toBe(false);
  expect(validCallbackState(issued.state,undefined,'a','test-secret',1001)).toBe(false);
 });
});

describe('Callback state secret selection',()=>{
 afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
 it('uses the dedicated key for issuing and verifying, rejecting old-key state',async()=>{
  vi.stubEnv('META_APP_SECRET','old-key');vi.stubEnv('WACRM_ES_STATE_SECRET','new-key');
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const {callbackStateSecret}=await import('./callback-state');
  const old=issueCallbackState('a','old-key');
  const current=issueCallbackState('a',callbackStateSecret());
  expect(callbackStateSecret()).toBe('new-key');expect(warn).not.toHaveBeenCalled();
  expect(validCallbackState(old.state,old.cookie,'a',callbackStateSecret())).toBe(false);
  expect(validCallbackState(current.state,current.cookie,'a','new-key')).toBe(true);
  expect(validCallbackState(current.state,current.cookie,'a','old-key')).toBe(false);
 });
 it('falls back to the first Meta key and warns exactly once across repeated selections',async()=>{
  vi.resetModules();vi.stubEnv('META_APP_SECRET',' old-key,second-key');vi.stubEnv('WACRM_ES_STATE_SECRET','');
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const {callbackStateSecret}=await import('./callback-state');
  const issued=issueCallbackState('a',callbackStateSecret());
  expect(validCallbackState(issued.state,issued.cookie,'a',callbackStateSecret())).toBe(true);
  expect(callbackStateSecret()).toBe('old-key');
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('WACRM_ES_STATE_SECRET is not set'));
 });
});

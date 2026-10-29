import {describe,it,expect} from 'vitest';
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

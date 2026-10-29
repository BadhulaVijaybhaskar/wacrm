import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionRows, type Connection } from './embedded-signup-card';

vi.mock('@/hooks/use-auth',()=>({useAuth:()=>({canEditSettings:true,accountId:'test-account'})}));
const rows = ['connected','pending','error','disconnected'].map((status,i):Connection=>({
  id:String(i),phone_number_id:status+'-number',display_phone_number:null,
  verified_name:null,quality_rating:null,waba_id:'123',status,
}));
function catalogue(locale:string){return JSON.parse(readFileSync(`messages/${locale}.json`,'utf8'));}
function render(locale:string,canEdit=true,busy=false){
  return renderToStaticMarkup(createElement(NextIntlClientProvider,{locale,messages:catalogue(locale),timeZone:'UTC'},
    createElement(ConnectionRows,{connections:rows,canEdit,busy,onDisconnect:vi.fn(),onRetry:vi.fn()})));
}
describe('Embedded Signup localized connection rows',()=>{
  it.each(['en','es','pt','ko'])('renders connected, pending and error rows with localized actions in %s',locale=>{
    const messages=catalogue(locale);
    const t=createTranslator({locale,messages,namespace:'Settings.whatsappConnections'});
    const html=render(locale);
    for(const status of ['connected','pending','error'])expect(html).toContain(status+'-number');
    expect(html).not.toContain('disconnected-number');
    for(const key of ['statusConnected','statusPending','statusError','disconnect','reconnect'])expect(html).toContain(t(key));
    expect(html.match(/<button/g)).toHaveLength(5); // three disconnect + two retry
    expect(html).not.toContain('Settings.whatsappConnections.');
  });
  it('does not show management actions to non-admins',()=>{
    const html=render('en',false);expect(html).toContain('pending-number');expect(html).toContain('error-number');
    expect(html).not.toContain('<button');
  });
  it('disables row actions while a connection attempt is in progress',()=>{
    const html=render('en',true,true);expect(html.match(/\sdisabled=""/g)).toHaveLength(5);
  });
  it.each(['es','pt','ko'])('has a complete, valid %s connection catalogue',locale=>{
    const messages=catalogue(locale);const expected=catalogue('en').Settings.whatsappConnections;
    expect(Object.keys(messages.Settings.whatsappConnections).sort()).toEqual(Object.keys(expected).sort());
    const onError=vi.fn();const t=createTranslator({locale,messages,namespace:'Settings.whatsappConnections',onError});
    for(const key of Object.keys(expected))expect(t(key,{name:'Test',quality:'GREEN',id:'123'})).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });
});

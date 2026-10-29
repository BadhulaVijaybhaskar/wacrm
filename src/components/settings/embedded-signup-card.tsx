'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { launchOptions, signupMessage, type OnboardingMode } from '@/lib/whatsapp/embedded-signup/launch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export type Connection = {id:string;phone_number_id:string;display_phone_number:string|null;verified_name:string|null;quality_rating:string|null;waba_id:string;status:string};
type Finish = {waba_id:string;phone_number_id?:string;business_id?:string;mode?:OnboardingMode};
type FBResponse = {authResponse?:{code?:string}};
type FacebookSDK = {init:(options:{appId:string;version:string})=>void;login:(callback:(r:FBResponse)=>void,options:object)=>void};
declare global { interface Window {FB?:FacebookSDK;fbAsyncInit?:()=>void} }

let sdkPromise: Promise<void> | undefined;
function loadSdk(appId:string,version:string) {
  if (!sdkPromise) sdkPromise = new Promise((resolve,reject)=>{
    if(window.FB){resolve();return;}
    const script=document.createElement('script');script.id='facebook-jssdk';script.src='https://connect.facebook.net/en_US/sdk.js';
    script.async=true;script.onload=()=>resolve();script.onerror=()=>reject(new Error('sdk_load_failed'));
    document.head.appendChild(script);
  });
  return sdkPromise.then(()=>window.FB?.init({appId,version}));
}

function errorMessageKey(code:unknown){
  if(code==='pin_mismatch')return 'pinMismatch';
  if(code==='coexistence_required')return 'coexistenceRequired';
  return 'connectFailed';
}
export function EmbeddedSignupCard() {
  const t = useTranslations('Settings.whatsappConnections');
  const {canEditSettings,accountId} = useAuth();
  const [mode,setMode]=useState<OnboardingMode>('coexistence');
  const [enabled,setEnabled]=useState(false);
  const [list,setList]=useState<Connection[]>([]);
  const [state,setState]=useState<'idle'|'connecting'|'error'>('idle');
  const [message,setMessage]=useState('');
  const code=useRef<string|null>(null);
  const finish=useRef<Finish|null>(null);
  const callbackState=useRef<string|null>(null);
  const submitted=useRef(false);
  const alive=useRef(true);
  const refresh=useCallback(async()=>{
    const r=await fetch('/api/whatsapp/embedded-signup/connections');
    if(r.status===404){setEnabled(false);return;}
    if(!r.ok){setMessage(t('loadFailed'));setState('error');return;}
    const data=await r.json();
    setList(data.connections||[]);setEnabled(true);
  },[t]);
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;}},[refresh,accountId]);
  const complete=useCallback(async()=>{
    if(!code.current || !finish.current || submitted.current) return;
    submitted.current=true;
    const payload={code:code.current,...finish.current,mode:finish.current.mode||mode,source:'popup',state:callbackState.current??undefined};
    code.current=null;finish.current=null;callbackState.current=null;
    try {
      const r=await fetch('/api/whatsapp/embedded-signup/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const body=await r.json();
      if(!r.ok) {
        if(alive.current){setState('error');setMessage(t(errorMessageKey(body.code)));await refresh();}
        return;
      }
      if(alive.current){setState('idle');setMessage(t('connectedMessage'));await refresh();}
    } catch {if(alive.current){setState('error');setMessage(t('connectFailed'));}}
  },[refresh,t,mode]);
  useEffect(()=>{
    if(!enabled || !canEditSettings) return;
    function listener(event:MessageEvent) {
      const result=signupMessage(event.origin,event.data);
      if(result?.kind==='finish'){finish.current=result.assets;void complete();}
      else if(result?.kind==='cancelled'){setState('error');setMessage(t('cancelled'));}
    }
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[enabled,canEditSettings,complete,t]);
  async function start(){
    if(!canEditSettings)return;
    setState('connecting');setMessage('');code.current=null;finish.current=null;callbackState.current=null;submitted.current=false;
    try {
      const appId=process.env.NEXT_PUBLIC_META_APP_ID;
      const configId=process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
      if(!appId||!configId)throw new Error('configuration_error');
      const config=await fetch('/api/whatsapp/embedded-signup/config');
      if(!config.ok)throw new Error('configuration_error');
      const settings=await config.json();
      if(typeof settings.state!=='string')throw new Error('configuration_error');
      callbackState.current=settings.state;
      await loadSdk(appId,settings.graph_version||process.env.NEXT_PUBLIC_META_GRAPH_VERSION||'v26.0');
      if(!window.FB)throw new Error('sdk_unavailable');
      window.FB.login(r=>{
        if(r.authResponse?.code){code.current=r.authResponse.code;void complete();}
        else {setState('error');setMessage(t('authorizationIncomplete'));}
      },launchOptions(configId,mode));
    } catch{setState('error');setMessage(t('startFailed'));}
  }
  async function disconnect(id:string){
    if(!canEditSettings || !window.confirm(t('confirmDisconnect')))return;
    const r=await fetch('/api/whatsapp/embedded-signup/connections/'+encodeURIComponent(id)+'/disconnect',{method:'POST'});
    if(r.ok){setMessage(t('disconnectedMessage'));await refresh();}
    else {setState('error');setMessage(t('disconnectFailed'));}
  }
  async function checkConnection(){
    if(!canEditSettings)return;
    setState('connecting');
    try{const r=await fetch('/api/whatsapp/embedded-signup/health',{method:'POST'});
      setMessage(t(r.ok?'checkComplete':'checkFailed'));setState('idle');await refresh();}
    catch{setState('error');setMessage(t('checkFailed'));}
  }
  if(!enabled) return null;
  return <Card className="mt-6">
    <CardHeader><CardTitle>{t('title')}</CardTitle><CardDescription>{t('description')}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <ConnectionRows connections={list} canEdit={canEditSettings} busy={state==='connecting'}
        onDisconnect={id=>void disconnect(id)} onRetry={()=>void start()} onCheck={()=>void checkConnection()} />
      {list.every(x=>x.status==='disconnected')&&<p className="text-sm text-muted-foreground">{t('notConnected')}</p>}
      {canEditSettings&&<RadioGroup value={mode} disabled={state==='connecting'} onValueChange={value=>setMode(value as OnboardingMode)} aria-label={t('modeLabel')}>
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="coexistence" />{t('modeCoexistence')}</label>
        <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="standard" />{t('modeStandard')}</label>
      </RadioGroup>}
      {mode==='coexistence'&&<p className="text-sm text-muted-foreground">{t('syncNotice')}</p>}
      {canEditSettings&&<Button disabled={state==='connecting'} onClick={()=>void start()}>{t(state==='connecting'?'connecting':state==='error'?'retryFacebook':'continueFacebook')}</Button>}
      {!canEditSettings&&<p className="text-sm text-muted-foreground">{t('adminOnly')}</p>}
      {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </CardContent>
  </Card>;
}


export function ConnectionRows({connections,canEdit,busy,onDisconnect,onRetry,onCheck}: {
  connections: Connection[]; canEdit: boolean; busy: boolean;
  onDisconnect: (id:string)=>void; onRetry: ()=>void; onCheck?:()=>void;
}) {
  const t = useTranslations('Settings.whatsappConnections');
  return <>{connections.filter(x=>x.status!=='disconnected').map(x=><div key={x.id} className="rounded-lg border border-border p-4 space-y-2">
    <p className="font-medium text-foreground">{x.display_phone_number||x.phone_number_id}</p>
    <p className="text-sm text-muted-foreground">{t('nameQuality',{name:x.verified_name||t('noVerifiedName'),quality:x.quality_rating||t('unknown')})}</p>
    <p className="text-xs text-muted-foreground">{t('wabaId',{id:x.waba_id})}</p>
    <p className="text-sm text-muted-foreground">{t(x.status==='connected'?'statusConnected':x.status==='pending'?'statusPending':'statusError')}</p>
    {canEdit&&<div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={()=>onDisconnect(x.id)}>{t('disconnect')}</Button>
      {onCheck&&<Button variant="outline" size="sm" disabled={busy} onClick={onCheck}>{t('checkConnection')}</Button>}
      {x.status!=='connected'&&<Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>{t('reconnect')}</Button>}
    </div>}
  </div>)}</>;
}

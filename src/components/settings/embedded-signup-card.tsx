'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export type Connection = {id:string;phone_number_id:string;display_phone_number:string|null;verified_name:string|null;quality_rating:string|null;waba_id:string;status:string};
type Finish = {waba_id:string;phone_number_id:string;business_id?:string};
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

export function EmbeddedSignupCard() {
  const t = useTranslations('Settings.whatsappConnections');
  const {canEditSettings,accountId} = useAuth();
  const [enabled,setEnabled]=useState(false);
  const [list,setList]=useState<Connection[]>([]);
  const [state,setState]=useState<'idle'|'connecting'|'error'>('idle');
  const [message,setMessage]=useState('');
  const code=useRef<string|null>(null);
  const finish=useRef<Finish|null>(null);
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
    const payload={code:code.current,...finish.current};
    code.current=null;finish.current=null;
    try {
      const r=await fetch('/api/whatsapp/embedded-signup/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const body=await r.json();
      if(!r.ok) {
        if(alive.current){setState('error');setMessage(t(body.code==='pin_mismatch'?'pinMismatch':'connectFailed'));await refresh();}
        return;
      }
      if(alive.current){setState('idle');setMessage(t('connectedMessage'));await refresh();}
    } catch {if(alive.current){setState('error');setMessage(t('connectFailed'));}}
  },[refresh,t]);
  useEffect(()=>{
    if(!enabled || !canEditSettings) return;
    function listener(event:MessageEvent) {
      let host:string;try{host=new URL(event.origin).hostname;}catch{return;}
      if(host!=='facebook.com' && !host.endsWith('.facebook.com')) return;
      let payload:unknown=event.data;
      if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch{return;}}
      if(!payload || typeof payload!=='object') return;
      const data=payload as {type?:string;event?:string;data?:Finish};
      if(data.type!=='WA_EMBEDDED_SIGNUP') return;
      if(data.event==='FINISH' && data.data && /^\d+$/.test(data.data.waba_id) && /^\d+$/.test(data.data.phone_number_id)){
        finish.current=data.data;void complete();
      } else if(data.event==='CANCEL'||data.event==='ERROR'){
        setState('error');setMessage(t('cancelled'));
      }
    }
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[enabled,canEditSettings,complete,t]);
  async function start(){
    if(!canEditSettings)return;
    setState('connecting');setMessage('');code.current=null;finish.current=null;submitted.current=false;
    try {
      const appId=process.env.NEXT_PUBLIC_META_APP_ID;
      const configId=process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
      if(!appId||!configId)throw new Error('configuration_error');
      await loadSdk(appId,process.env.NEXT_PUBLIC_META_GRAPH_VERSION||'v23.0');
      if(!window.FB)throw new Error('sdk_unavailable');
      window.FB.login(r=>{
        if(r.authResponse?.code){code.current=r.authResponse.code;void complete();}
        else {setState('error');setMessage(t('authorizationIncomplete'));}
      },{config_id:configId,response_type:'code',override_default_response_type:true,
        extras:{setup:{},featureType:'',sessionInfoVersion:'3'}});
    } catch{setState('error');setMessage(t('startFailed'));}
  }
  async function disconnect(id:string){
    if(!canEditSettings || !window.confirm(t('confirmDisconnect')))return;
    const r=await fetch('/api/whatsapp/embedded-signup/connections/'+encodeURIComponent(id)+'/disconnect',{method:'POST'});
    if(r.ok){setMessage(t('disconnectedMessage'));await refresh();}
    else {setState('error');setMessage(t('disconnectFailed'));}
  }
  if(!enabled) return null;
  return <Card className="mt-6">
    <CardHeader><CardTitle>{t('title')}</CardTitle><CardDescription>{t('description')}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <ConnectionRows connections={list} canEdit={canEditSettings} busy={state==='connecting'}
        onDisconnect={id=>void disconnect(id)} onRetry={()=>void start()} />
      {list.every(x=>x.status==='disconnected')&&<p className="text-sm text-muted-foreground">{t('notConnected')}</p>}
      {canEditSettings&&<Button disabled={state==='connecting'} onClick={()=>void start()}>{t(state==='connecting'?'connecting':state==='error'?'retryFacebook':'continueFacebook')}</Button>}
      {!canEditSettings&&<p className="text-sm text-muted-foreground">{t('adminOnly')}</p>}
      {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </CardContent>
  </Card>;
}


export function ConnectionRows({connections,canEdit,busy,onDisconnect,onRetry}: {
  connections: Connection[]; canEdit: boolean; busy: boolean;
  onDisconnect: (id:string)=>void; onRetry: ()=>void;
}) {
  const t = useTranslations('Settings.whatsappConnections');
  return <>{connections.filter(x=>x.status!=='disconnected').map(x=><div key={x.id} className="rounded-lg border border-border p-4 space-y-2">
    <p className="font-medium text-foreground">{x.display_phone_number||x.phone_number_id}</p>
    <p className="text-sm text-muted-foreground">{t('nameQuality',{name:x.verified_name||t('noVerifiedName'),quality:x.quality_rating||t('unknown')})}</p>
    <p className="text-xs text-muted-foreground">{t('wabaId',{id:x.waba_id})}</p>
    <p className="text-sm text-muted-foreground">{t(x.status==='connected'?'statusConnected':x.status==='pending'?'statusPending':'statusError')}</p>
    {canEdit&&<div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={()=>onDisconnect(x.id)}>{t('disconnect')}</Button>
      {x.status!=='connected'&&<Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>{t('retry')}</Button>}
    </div>}
  </div>)}</>;
}

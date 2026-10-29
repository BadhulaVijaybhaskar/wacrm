'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Connection = {id:string;phone_number_id:string;display_phone_number:string|null;verified_name:string|null;quality_rating:string|null;waba_id:string;status:string};
type Finish = {waba_id:string;phone_number_id:string;business_id?:string};
type FBResponse = {authResponse?:{code?:string}};
type FacebookSDK = {init:(options:{appId:string;version:string})=>void;login:(callback:(r:FBResponse)=>void,options:object)=>void};
declare global { interface Window {FB?:FacebookSDK;fbAsyncInit?:()=>void} }

let sdkPromise: Promise<void> | undefined;
function loadSdk(appId:string,version:string) {
  if (!sdkPromise) sdkPromise = new Promise((resolve,reject)=>{
    if(window.FB){resolve();return;}
    const script=document.createElement('script');script.id='facebook-jssdk';script.src='https://connect.facebook.net/en_US/sdk.js';
    script.async=true;script.onload=()=>resolve();script.onerror=()=>reject(new Error('Could not load sign-in'));
    document.head.appendChild(script);
  });
  return sdkPromise.then(()=>window.FB?.init({appId,version}));
}

export function EmbeddedSignupCard() {
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
    if(!r.ok){setMessage('Unable to load WhatsApp connections.');setState('error');return;}
    const data=await r.json();
    setList(data.connections||[]);setEnabled(true);
  },[]);
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;}},[refresh,accountId]);
  const complete=useCallback(async()=>{
    if(!code.current || !finish.current || submitted.current) return;
    submitted.current=true;
    const payload={code:code.current,...finish.current};
    code.current=null;finish.current=null;
    try {
      const r=await fetch('/api/whatsapp/embedded-signup/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const body=await r.json();
      if(!r.ok) throw new Error(typeof body.message==='string'?body.message:'Unable to connect WhatsApp.');
      if(alive.current){setState('idle');setMessage('WhatsApp connected.');await refresh();}
    } catch {if(alive.current){setState('error');setMessage('Connection failed. Please retry.');}}
  },[refresh]);
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
        setState('error');setMessage('Setup was cancelled or failed. Retry when ready.');
      }
    }
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[enabled,canEditSettings,complete]);
  async function start(){
    if(!canEditSettings)return;
    setState('connecting');setMessage('');code.current=null;finish.current=null;submitted.current=false;
    try {
      const appId=process.env.NEXT_PUBLIC_META_APP_ID;
      const configId=process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
      if(!appId||!configId)throw new Error('Not configured');
      await loadSdk(appId,process.env.NEXT_PUBLIC_META_GRAPH_VERSION||'v23.0');
      if(!window.FB)throw new Error('SDK unavailable');
      window.FB.login(r=>{
        if(r.authResponse?.code){code.current=r.authResponse.code;void complete();}
        else {setState('error');setMessage('Authorization was not completed.');}
      },{config_id:configId,response_type:'code',override_default_response_type:true,
        extras:{setup:{},featureType:'',sessionInfoVersion:'3'}});
    } catch{setState('error');setMessage('Unable to start setup. Check your browser and configuration.');}
  }
  async function disconnect(id:string){
    if(!canEditSettings || !window.confirm('Disconnect this WhatsApp number?'))return;
    const r=await fetch('/api/whatsapp/embedded-signup/connections/'+encodeURIComponent(id)+'/disconnect',{method:'POST'});
    if(r.ok){setMessage('WhatsApp disconnected.');await refresh();}
    else {setState('error');setMessage('Unable to disconnect number.');}
  }
  if(!enabled) return null;
  return <Card className="mt-6">
    <CardHeader><CardTitle>Connect WhatsApp</CardTitle><CardDescription>Connect a business number to your account.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {list.filter(x=>x.status==='connected').map(x=><div key={x.id} className="rounded-lg border border-border p-4 space-y-2">
        <p className="font-medium text-foreground">{x.display_phone_number||x.phone_number_id}</p>
        <p className="text-sm text-muted-foreground">{x.verified_name||'No verified name'} · Quality: {x.quality_rating||'Unknown'}</p>
        <p className="text-xs text-muted-foreground">WABA ID: {x.waba_id}</p>
        {canEditSettings&&<Button variant="outline" size="sm" onClick={()=>void disconnect(x.id)}>Disconnect</Button>}
      </div>)}
      {list.every(x=>x.status!=='connected')&&<p className="text-sm text-muted-foreground">Not connected</p>}
      {canEditSettings&&<Button disabled={state==='connecting'} onClick={()=>void start()}>{state==='connecting'?'Connecting…':state==='error'?'Retry · Continue with Facebook':'Continue with Facebook'}</Button>}
      {!canEditSettings&&<p className="text-sm text-muted-foreground">Only account administrators can manage connections.</p>}
      {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </CardContent>
  </Card>;
}

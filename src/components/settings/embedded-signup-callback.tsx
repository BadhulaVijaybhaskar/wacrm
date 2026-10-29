'use client';
import { useEffect,useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { consumeSettingsCallback } from '@/lib/whatsapp/embedded-signup/launch';
export function EmbeddedSignupCallback(){
  const {loading,profileLoading,canEditSettings,accountId}=useAuth();
  const t=useTranslations('Settings.whatsappConnections');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    if(loading||profileLoading||!accountId||!new URL(window.location.href).searchParams.has('code'))return;
    // The feature probe contains no OAuth code or secret; server completion
    // rechecks the flag and admin role before exchanging anything with Meta.
    void (async()=>{
      const probe=await fetch('/api/whatsapp/embedded-signup/connections');
      if(!probe.ok)return;
      const callback=consumeSettingsCallback(window.location.href,true,canEditSettings,
        url=>window.history.replaceState(null,'',url));
      if(callback.kind==='forbidden'){setMessage(t('adminOnly'));return;}
      if(callback.kind!=='complete')return;
      setMessage(t('connecting'));
      try{
        const response=await fetch('/api/whatsapp/embedded-signup/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(callback.payload)});
        const result=await response.json();
        setMessage(t(response.ok?'connectedMessage':result.error==='callback_state_invalid'?'callbackUntrusted':'connectFailed'));
      }catch{setMessage(t('connectFailed'));}
    })().catch(()=>setMessage(t('connectFailed')));
  },[loading,profileLoading,canEditSettings,accountId,t]);
  return message?<p role="status" className="mt-4 text-sm text-muted-foreground">{message}</p>:null;
}

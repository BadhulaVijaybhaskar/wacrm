export type OnboardingMode = 'coexistence' | 'standard';
export function launchOptions(configId: string, mode: OnboardingMode) {
  // https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4
  // https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
  return {config_id:configId,response_type:'code',override_default_response_type:true,
    extras:{version:'v4',sessionInfoVersion:'3',setup:{},
      ...(mode==='coexistence'?{featureType:'whatsapp_business_app_onboarding'}:{})}};
}
export function consumeSettingsCallback(url: string, enabled: boolean, admin: boolean, replace: (url:string)=>void) {
  const parsed=new URL(url);const code=parsed.searchParams.get('code');
  if(!enabled||!code)return {kind:'ignored' as const};
  const state=parsed.searchParams.get('state')||undefined;
  const waba_id=parsed.searchParams.get('waba_id')||undefined;
  const phone_number_id=parsed.searchParams.get('phone_number_id')||undefined;
  for(const key of ['code','waba_id','phone_number_id','state'])parsed.searchParams.delete(key);
  parsed.searchParams.set('tab','whatsapp');
  // Remove credentials before any await; StrictMode/re-render sees no code to reconsume.
  replace(parsed.pathname+parsed.search+parsed.hash);
  if(!admin)return {kind:'forbidden' as const};
  // Hosted ES currently documents PARTNER_ADDED, not guaranteed OAuth URL params:
  // https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/hosted-es
  return {kind:'complete' as const,payload:{code,waba_id,phone_number_id,state,source:'hosted' as const}};
}

export function signupMessage(origin:string,value:unknown){
  let url:URL;try{url=new URL(origin);}catch{return null;}
  if(url.protocol!=='https:'||(url.hostname!=='facebook.com'&&!url.hostname.endsWith('.facebook.com')))return null;
  let data=value;if(typeof data==='string'){try{data=JSON.parse(data);}catch{return null;}}
  if(!data||typeof data!=='object')return null;
  const v=data as {type?:string;event?:string;data?:Record<string,unknown>};
  if(v.type!=='WA_EMBEDDED_SIGNUP')return null;
  if(v.event==='CANCEL'||v.event==='ERROR')return {kind:'cancelled' as const};
  if(!['FINISH','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(v.event||''))return null;
  const a=v.data;if(!a||typeof a.waba_id!=='string'||!/^\d{1,32}$/.test(a.waba_id))return null;
  const phone_number_id=typeof a.phone_number_id==='string'&&/^\d{1,32}$/.test(a.phone_number_id)?a.phone_number_id:undefined;
  const business_id=typeof a.business_id==='string'&&/^\d{1,32}$/.test(a.business_id)?a.business_id:undefined;
  return {kind:'finish' as const,assets:{waba_id:a.waba_id,phone_number_id,business_id,
    ...(v.event==='FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'?{mode:'coexistence' as const}:{})}};
}

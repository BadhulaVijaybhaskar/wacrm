import {callbackStateSecret,issueCallbackState,CALLBACK_COOKIE} from '@/lib/whatsapp/embedded-signup/callback-state';
import { NextResponse } from 'next/server';
import { requireRole,UnauthorizedError,ForbiddenError } from '@/lib/auth/account';
import { enabled,graphVersion,publicError } from '@/lib/whatsapp/embedded-signup/core';
export async function GET(){
  if(!enabled())return NextResponse.json({error:'not_found'},{status:404});
  try{const {accountId}=await requireRole('admin');const secret=callbackStateSecret();
    if(!secret)throw new Error('configuration_error');
    const issued=issueCallbackState(accountId,secret);
    const response=NextResponse.json({graph_version:graphVersion(),state:issued.state});
    response.cookies.set(CALLBACK_COOKIE,issued.cookie,{httpOnly:true,secure:true,sameSite:'lax',path:'/api/whatsapp/embedded-signup/complete',maxAge:600});
    return response;
  }
  catch(error){if(error instanceof UnauthorizedError||error instanceof ForbiddenError)return NextResponse.json({error:'forbidden'},{status:error.status});const e=publicError(error);return NextResponse.json(e.body,{status:e.status});}
}

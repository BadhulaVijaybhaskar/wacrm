import {CALLBACK_COOKIE,validCallbackState} from '@/lib/whatsapp/embedded-signup/callback-state';
import { NextResponse } from 'next/server';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { connect, enabled, publicError, signupInput, SignupError } from '@/lib/whatsapp/embedded-signup/core';
export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let clearCallback=false;
  const reply=(response:NextResponse)=>{
    if(clearCallback)response.cookies.set(CALLBACK_COOKIE,'',{httpOnly:true,secure:true,sameSite:'lax',path:'/api/whatsapp/embedded-signup/complete',maxAge:0});
    return response;
  };
  try {
    const ctx = await requireRole('admin');
    const input = signupInput.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new SignupError('invalid_request', 400);
    if(input.data.source==='hosted'){
      const cookie=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(CALLBACK_COOKIE+'='))?.slice(CALLBACK_COOKIE.length+1);
      const secret=process.env.META_APP_SECRET?.split(',')[0]?.trim()||'';
      if(!validCallbackState(input.data.state,cookie,ctx.accountId,secret))throw new SignupError('callback_state_invalid',403);
      clearCallback=true;
    }
    return reply(NextResponse.json(await connect(input.data, ctx.accountId)));
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'forbidden' }, { status: error.status });
    }
    const result = publicError(error);
    return reply(NextResponse.json(result.body, { status: result.status }));
  }
}

import { NextResponse } from 'next/server';
import { requireRole,UnauthorizedError,ForbiddenError } from '@/lib/auth/account';
import { enabled,publicError } from '@/lib/whatsapp/embedded-signup/core';
import { checkAccountConnections } from '@/lib/whatsapp/embedded-signup/health';
export async function POST(){
  if(!enabled())return NextResponse.json({error:'not_found'},{status:404});
  try{const {accountId}=await requireRole('admin');return NextResponse.json(await checkAccountConnections(accountId));}
  catch(error){if(error instanceof UnauthorizedError||error instanceof ForbiddenError)return NextResponse.json({error:'forbidden'},{status:error.status});const e=publicError(error);return NextResponse.json(e.body,{status:e.status});}
}

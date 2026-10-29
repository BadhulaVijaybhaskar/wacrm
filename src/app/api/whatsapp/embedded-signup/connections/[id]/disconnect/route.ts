import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/account';
import { createServiceClient } from '@/lib/supabase/admin';
import { decryptToken } from '@/lib/whatsapp/embedded-signup/crypto';
import { enabled, unsubscribe } from '@/lib/whatsapp/embedded-signup/core';
export async function POST(_request: Request, context: {params: Promise<{id:string}>}) {
  if (!enabled()) return NextResponse.json({error:'not_found'},{status:404});
  try {
    const {accountId} = await requireRole('admin');
    const {id} = await context.params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({error:'not_found'},{status:404});
    const db = createServiceClient().schema('wacrm');
    const {data:row} = await db.from('wa_connections').select('id,waba_id,token_ciphertext,status')
      .eq('account_id',accountId).eq('id',id).maybeSingle();
    if(!row) return NextResponse.json({error:'not_found'},{status:404});
    if(row.status === 'connected') await unsubscribe(row.waba_id, decryptToken(row.token_ciphertext));
    const {error} = await db.from('wa_connections').update({status:'disconnected',updated_at:new Date().toISOString()})
      .eq('account_id',accountId).eq('id',id);
    if(error) return NextResponse.json({error:'database_error'},{status:500});
    return NextResponse.json({status:'disconnected'});
  } catch {return NextResponse.json({error:'forbidden_or_failed'},{status:403});}
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
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
    const {data:row, error: lookupError} = await db.from('wa_connections').select('id,waba_id,token_ciphertext,status')
      .eq('account_id',accountId).eq('id',id).maybeSingle();
    if (lookupError) return NextResponse.json({error:'database_error'},{status:500});
    if (!row) return NextResponse.json({error:'not_found'},{status:404});
    // Retry unsubscribe for an error/pending row too: a prior subscribe might
    // have succeeded remotely even when its response was lost.
    let failed = false;
    if (row.status !== 'disconnected') {
      try { await unsubscribe(row.waba_id, decryptToken(row.token_ciphertext)); }
      catch { failed = true; }
    }
    const {error} = await db.from('wa_connections').update({
      status: failed ? 'error' : 'disconnected',
      last_error: failed ? 'meta_request_failed' : null,
      updated_at:new Date().toISOString(),
    }).eq('account_id',accountId).eq('id',id);
    if (error) return NextResponse.json({error:'database_error'},{status:500});
    if (failed) return NextResponse.json({error:'meta_request_failed'},{status:502});
    return NextResponse.json({status:'disconnected'});
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError)
      return NextResponse.json({error:'forbidden'},{status:403});
    return NextResponse.json({error:'internal_error'},{status:500});
  }
}

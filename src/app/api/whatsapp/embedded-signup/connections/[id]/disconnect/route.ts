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
    // Subscriptions are WABA-wide: never remove delivery for a sibling number,
    // including another account's pending claim on the same WABA.
    const {data:siblings, error:siblingError} = await db.from('wa_connections').select('id')
      .eq('waba_id',row.waba_id).neq('id',id).in('status',['connected','pending']).limit(1);
    if (siblingError) return NextResponse.json({error:'database_error'},{status:500});
    const {data:legacyNumbers, error:legacyError} = await db.from('whatsapp_config').select('id')
      .eq('waba_id',row.waba_id).limit(1);
    if (legacyError || !legacyNumbers) return NextResponse.json({error:'database_error'},{status:500});
    let failed = false;
    if (row.status !== 'disconnected' && !siblings?.length && legacyNumbers.length === 0) {
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
      return NextResponse.json({error:'forbidden'},{status:error.status});
    return NextResponse.json({error:'internal_error'},{status:500});
  }
}

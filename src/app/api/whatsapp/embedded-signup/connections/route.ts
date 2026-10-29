import { NextResponse } from 'next/server';
import { getCurrentAccount, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { enabled } from '@/lib/whatsapp/embedded-signup/core';
export async function GET() {
  if (!enabled()) return NextResponse.json({error:'not_found'}, {status:404});
  try {
    const {accountId} = await getCurrentAccount();
    const {createServiceClient} = await import('@/lib/supabase/admin');
    const {data,error} = await createServiceClient().schema('wacrm').from('wa_connections')
      .select('id,account_id,waba_id,phone_number_id,business_id,display_phone_number,verified_name,quality_rating,status,last_error,created_at,updated_at')
      .eq('account_id',accountId).order('created_at',{ascending:false});
    if(error) return NextResponse.json({error:'database_error'},{status:500});
    return NextResponse.json({connections:data || []});
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError)
      return NextResponse.json({error:'forbidden'},{status:error.status});
    return NextResponse.json({error:'internal_error'},{status:500});
  }
}

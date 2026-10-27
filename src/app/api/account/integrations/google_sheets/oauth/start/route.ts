import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { buildGoogleOAuthAuthorizeUrl } from '@/lib/integrations/sheets/oauth';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const { data } = await ctx.supabase
      .from('integration_connections')
      .select('credentials_encrypted, config')
      .eq('account_id', ctx.accountId)
      .eq('provider', 'google_sheets')
      .maybeSingle();

    const creds = decryptCredentials(data?.credentials_encrypted as string | null);
    const clientId = creds.client_id;
    if (!clientId) {
      return NextResponse.json(
        { error: 'Connect Google Sheets and save client_id first' },
        { status: 400 },
      );
    }

    const origin = new URL(request.url).origin;
    const redirectUri = `${origin}/api/account/integrations/google_sheets/oauth/callback`;
    const state = Buffer.from(
      JSON.stringify({ accountId: ctx.accountId, userId: ctx.userId }),
    ).toString('base64url');

    const url = buildGoogleOAuthAuthorizeUrl({
      clientId,
      redirectUri,
      state,
    });

    return NextResponse.json({ url, redirect_uri: redirectUri });
  } catch (err) {
    return toErrorResponse(err);
  }
}

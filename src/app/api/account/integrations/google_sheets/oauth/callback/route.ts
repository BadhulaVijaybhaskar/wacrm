import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { exchangeGoogleAuthCode } from '@/lib/integrations/sheets/oauth';
import { persistSheetsTokens } from '@/lib/integrations/sheets/sync';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(request.url);
    const code = url.searchParams.get('code') ?? '';
    const stateRaw = url.searchParams.get('state') ?? '';

    if (stateRaw) {
      try {
        const state = JSON.parse(
          Buffer.from(stateRaw, 'base64url').toString('utf8'),
        ) as { accountId?: string };
        if (state.accountId && state.accountId !== ctx.accountId) {
          return NextResponse.json({ error: 'State mismatch' }, { status: 403 });
        }
      } catch {
        /* ignore malformed state in stub */
      }
    }

    const { data } = await ctx.supabase
      .from('integration_connections')
      .select('credentials_encrypted')
      .eq('account_id', ctx.accountId)
      .eq('provider', 'google_sheets')
      .maybeSingle();
    const creds = decryptCredentials(data?.credentials_encrypted as string | null);
    if (!creds.client_id || !creds.client_secret) {
      return NextResponse.json(
        { error: 'Missing OAuth client credentials' },
        { status: 400 },
      );
    }

    const tokens = await exchangeGoogleAuthCode({
      clientId: creds.client_id,
      clientSecret: creds.client_secret,
      redirectUri: `${url.origin}/api/account/integrations/google_sheets/oauth/callback`,
      code: code || 'stub_code',
    });

    await persistSheetsTokens(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      spreadsheetId: creds.spreadsheet_id,
    });

    return NextResponse.redirect(
      new URL('/settings?tab=integrations&sheets=connected', url.origin),
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

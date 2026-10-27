import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decryptCredentials } from '@/lib/integrations/credentials';
import {
  exportContactsToSheet,
  importContactsFromSheet,
} from '@/lib/integrations/sheets/sync';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:sheetsSync:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const direction = body.direction === 'export' ? 'export' : 'import';

    const { data } = await ctx.supabase
      .from('integration_connections')
      .select('credentials_encrypted, config, status')
      .eq('account_id', ctx.accountId)
      .eq('provider', 'google_sheets')
      .maybeSingle();

    if (!data || data.status !== 'connected') {
      return NextResponse.json(
        { error: 'Google Sheets is not connected' },
        { status: 400 },
      );
    }

    const creds = decryptCredentials(data.credentials_encrypted as string | null);
    const config = (data.config ?? {}) as Record<string, unknown>;
    const spreadsheetId =
      (typeof body.spreadsheet_id === 'string' && body.spreadsheet_id) ||
      (typeof config.spreadsheet_id === 'string' && config.spreadsheet_id) ||
      creds.spreadsheet_id;
    if (!spreadsheetId) {
      return NextResponse.json(
        { error: 'spreadsheet_id required' },
        { status: 400 },
      );
    }
    const accessToken = creds.access_token || 'stub_token';

    const result =
      direction === 'export'
        ? await exportContactsToSheet(ctx.supabase, {
            accountId: ctx.accountId,
            spreadsheetId,
            accessToken,
          })
        : await importContactsFromSheet(ctx.supabase, {
            accountId: ctx.accountId,
            spreadsheetId,
            accessToken,
          });

    return NextResponse.json({ direction, ...result });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

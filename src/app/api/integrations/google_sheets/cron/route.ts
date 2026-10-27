import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { importContactsFromSheet } from '@/lib/integrations/sheets/sync';

function secretsMatch(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Scheduled Sheets import. Auth: x-cron-secret === AUTOMATION_CRON_SECRET */
export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  if (!secretsMatch(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: rows } = await db
    .from('integration_connections')
    .select('account_id, credentials_encrypted, config')
    .eq('provider', 'google_sheets')
    .eq('status', 'connected')
    .limit(50);

  let ran = 0;
  for (const row of rows ?? []) {
    const creds = decryptCredentials(row.credentials_encrypted as string | null);
    const config = (row.config ?? {}) as Record<string, unknown>;
    const spreadsheetId =
      (typeof config.spreadsheet_id === 'string' && config.spreadsheet_id) ||
      creds.spreadsheet_id;
    if (!spreadsheetId) continue;
    await importContactsFromSheet(db, {
      accountId: row.account_id as string,
      spreadsheetId,
      accessToken: creds.access_token || 'stub_token',
    });
    ran += 1;
  }

  return NextResponse.json({ ok: true, accounts: ran });
}

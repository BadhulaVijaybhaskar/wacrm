import type { SupabaseClient } from '@supabase/supabase-js';

import {
  applyColumnMapping,
  autoDetectColumnMapping,
} from '@/lib/contacts/column-map';
import { validateImportRows } from '@/lib/contacts/validate-import';
import {
  decryptCredentials,
  encryptCredentials,
} from '@/lib/integrations/credentials';
import { appendIntegrationEvent } from '@/lib/integrations/event-log';
import { createSheetsClient } from './client';

export async function importContactsFromSheet(
  db: SupabaseClient,
  opts: {
    accountId: string;
    spreadsheetId: string;
    sheetName?: string;
    accessToken: string;
  },
): Promise<{ rowsOk: number; rowsError: number; stub: boolean }> {
  const client = createSheetsClient(opts.accessToken);
  const range = `${opts.sheetName ?? 'Sheet1'}!A1:Z1000`;
  const { values } = await client.getValues(opts.spreadsheetId, range);
  if (!values.length) {
    return { rowsOk: 0, rowsError: 0, stub: true };
  }
  const headers = values[0] ?? [];
  const mapping = autoDetectColumnMapping(headers);
  const mapped = applyColumnMapping(headers, values.slice(1), mapping);

  const existing = new Set<string>();
  const { data: contacts } = await db
    .from('contacts')
    .select('phone')
    .eq('account_id', opts.accountId)
    .limit(5000);
  for (const c of contacts ?? []) {
    if (typeof c.phone === 'string') {
      existing.add(c.phone.replace(/\D/g, ''));
    }
  }

  const validated = validateImportRows(mapped, {
    defaultCountry: 'IN',
    existingNormalized: existing,
  });

  let rowsOk = 0;
  for (const row of validated.ready) {
    const { error } = await db.from('contacts').insert({
      account_id: opts.accountId,
      phone: row.e164,
      name: row.name || null,
      email: row.email || null,
      company: row.company || null,
    });
    if (!error) rowsOk += 1;
  }

  const rowsError =
    validated.invalidPhone +
    validated.duplicatesInFile +
    validated.duplicatesExisting;

  await db.from('sheets_sync_runs').insert({
    account_id: opts.accountId,
    direction: 'import',
    spreadsheet_id: opts.spreadsheetId,
    sheet_name: opts.sheetName ?? 'Sheet1',
    status: 'success',
    rows_ok: rowsOk,
    rows_error: rowsError,
    message: 'import complete',
    finished_at: new Date().toISOString(),
  });

  await appendIntegrationEvent(db, {
    accountId: opts.accountId,
    provider: 'google_sheets',
    eventType: 'sheets.import',
    status: 'success',
    message: `Imported ${rowsOk} contacts (${rowsError} errors)`,
  });

  return { rowsOk, rowsError, stub: true };
}

export async function exportContactsToSheet(
  db: SupabaseClient,
  opts: {
    accountId: string;
    spreadsheetId: string;
    sheetName?: string;
    accessToken: string;
  },
): Promise<{ rowsOk: number; stub: boolean }> {
  const { data: contacts } = await db
    .from('contacts')
    .select('phone, name, email, company')
    .eq('account_id', opts.accountId)
    .limit(2000);

  const values: string[][] = [
    ['phone', 'name', 'email', 'company', 'tags'],
    ...(contacts ?? []).map((c) => [
      String(c.phone ?? ''),
      String(c.name ?? ''),
      String(c.email ?? ''),
      String(c.company ?? ''),
      '',
    ]),
  ];

  const client = createSheetsClient(opts.accessToken);
  const range = `${opts.sheetName ?? 'Sheet1'}!A1`;
  const result = await client.updateValues(opts.spreadsheetId, range, values);

  await db.from('sheets_sync_runs').insert({
    account_id: opts.accountId,
    direction: 'export',
    spreadsheet_id: opts.spreadsheetId,
    sheet_name: opts.sheetName ?? 'Sheet1',
    status: 'success',
    rows_ok: result.updatedRows,
    rows_error: 0,
    message: 'export complete',
    finished_at: new Date().toISOString(),
  });

  await appendIntegrationEvent(db, {
    accountId: opts.accountId,
    provider: 'google_sheets',
    eventType: 'sheets.export',
    status: 'success',
    message: `Exported ${result.updatedRows} rows`,
  });

  return { rowsOk: result.updatedRows, stub: true };
}

export async function persistSheetsTokens(
  db: SupabaseClient,
  opts: {
    accountId: string;
    userId: string;
    accessToken: string;
    refreshToken?: string;
    spreadsheetId?: string;
  },
): Promise<void> {
  const { data: existing } = await db
    .from('integration_connections')
    .select('credentials_encrypted, config')
    .eq('account_id', opts.accountId)
    .eq('provider', 'google_sheets')
    .maybeSingle();

  const prev = decryptCredentials(
    existing?.credentials_encrypted as string | null,
  );
  const next = {
    ...prev,
    access_token: opts.accessToken,
    ...(opts.refreshToken ? { refresh_token: opts.refreshToken } : {}),
  };
  const config = {
    ...((existing?.config as Record<string, unknown>) ?? {}),
    ...(opts.spreadsheetId ? { spreadsheet_id: opts.spreadsheetId } : {}),
  };

  await db.from('integration_connections').upsert(
    {
      account_id: opts.accountId,
      provider: 'google_sheets',
      status: 'connected',
      credentials_encrypted: encryptCredentials(next),
      config,
      connected_at: new Date().toISOString(),
      connected_by: opts.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id,provider' },
  );
}

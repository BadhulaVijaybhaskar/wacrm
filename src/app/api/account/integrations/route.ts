import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  INTEGRATION_CATALOG,
  type IntegrationProvider,
} from '@/lib/integrations/catalog';
import {
  listConnections,
  toPublicConnection,
  type IntegrationConnectionRow,
} from '@/lib/integrations/store';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const rows = await listConnections(ctx.supabase, ctx.accountId);
    const byProvider = new Map(
      rows.map((r) => [r.provider, r as IntegrationConnectionRow]),
    );

    const connections = INTEGRATION_CATALOG.map((meta) =>
      toPublicConnection(
        byProvider.get(meta.id) ?? null,
        meta.id as IntegrationProvider,
      ),
    );

    return NextResponse.json({
      catalog: INTEGRATION_CATALOG,
      connections,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

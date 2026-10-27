import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { isIntegrationProvider } from '@/lib/integrations/catalog';
import { listIntegrationEvents } from '@/lib/integrations/event-log';

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { provider: raw } = await context.params;
    if (!isIntegrationProvider(raw)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? '40');
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 40;

    const events = await listIntegrationEvents(ctx.supabase, {
      accountId: ctx.accountId,
      provider: raw,
      limit,
    });

    return NextResponse.json({ events });
  } catch (err) {
    return toErrorResponse(err);
  }
}

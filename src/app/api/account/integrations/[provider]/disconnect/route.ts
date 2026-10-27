import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isIntegrationProvider } from '@/lib/integrations/catalog';
import { disconnectIntegration } from '@/lib/integrations/store';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  _request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:integrationDisconnect:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { provider: raw } = await context.params;
    if (!isIntegrationProvider(raw)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }

    const connection = await disconnectIntegration(ctx.supabase, {
      accountId: ctx.accountId,
      provider: raw,
    });

    return NextResponse.json({ connection });
  } catch (err) {
    return toErrorResponse(err);
  }
}

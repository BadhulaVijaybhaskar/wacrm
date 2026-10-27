import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isIntegrationProvider } from '@/lib/integrations/catalog';
import { testIntegrationConnection } from '@/lib/integrations/store';
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
      `admin:integrationTest:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { provider: raw } = await context.params;
    if (!isIntegrationProvider(raw)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }

    const { connection, result } = await testIntegrationConnection(
      ctx.supabase,
      { accountId: ctx.accountId, provider: raw },
    );

    return NextResponse.json({
      connection,
      ok: result.ok,
      stub: result.stub,
      message: result.message,
      details: result.details ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

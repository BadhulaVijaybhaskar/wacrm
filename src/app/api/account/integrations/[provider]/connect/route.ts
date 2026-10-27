import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isIntegrationProvider } from '@/lib/integrations/catalog';
import { connectIntegration } from '@/lib/integrations/store';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `admin:integrationConnect:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { provider: raw } = await context.params;
    if (!isIntegrationProvider(raw)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const fields =
      body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
        ? (body.fields as Record<string, unknown>)
        : body;

    const connection = await connectIntegration(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      provider: raw,
      fields,
      displayName:
        typeof body.display_name === 'string' ? body.display_name : null,
    });

    return NextResponse.json({ connection });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Missing required')) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

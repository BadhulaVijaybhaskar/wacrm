import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { syncProductCatalog } from '@/lib/integrations/commerce/catalog';
import { isIntegrationProvider } from '@/lib/integrations/catalog';
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
      `admin:catalogSync:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { provider: raw } = await context.params;
    if (raw !== 'shopify' && raw !== 'woocommerce') {
      return NextResponse.json(
        { error: 'Catalog sync is only for shopify/woocommerce' },
        { status: 400 },
      );
    }
    if (!isIntegrationProvider(raw)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
    }

    const result = await syncProductCatalog(ctx.supabase, {
      accountId: ctx.accountId,
      provider: raw,
    });

    if (!result.stub && result.synced === 0) {
      return NextResponse.json(
        {
          error:
            'Live catalog sync is not enabled. Set META_STUB=1 or INTEGRATIONS_STUB=1.',
        },
        { status: 503 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}

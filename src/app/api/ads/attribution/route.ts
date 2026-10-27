import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { aggregateAdReport } from '@/lib/ads/ctwa';

/**
 * GET /api/ads/attribution — conversations + conversions per CTWA ad.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');

    const { data, error } = await supabase
      .from('ad_attributions')
      .select('source_id, ad_id, headline, converted_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (error) {
      console.error('[ads/attribution]', error.message);
      return NextResponse.json(
        { error: 'Failed to load attribution' },
        { status: 500 },
      );
    }

    const rows = (data ?? []).map((r) => ({
      source_id: (r.source_id as string | null) ?? null,
      ad_id: (r.ad_id as string | null) ?? null,
      headline: (r.headline as string | null) ?? null,
      converted_at: (r.converted_at as string | null) ?? null,
    }));

    return NextResponse.json({
      report: aggregateAdReport(rows),
      total_rows: rows.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

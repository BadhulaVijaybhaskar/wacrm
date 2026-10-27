/**
 * Click-to-WhatsApp (CTWA) referral parsing + attribution helpers.
 * Meta includes a `referral` object on the first inbound message from
 * an ad click. We store first-touch on the contact and last-touch on
 * the conversation, plus a row in `ad_attributions` for reporting.
 */

export interface CtwaReferral {
  source_id: string | null;
  ctwa_clid: string | null;
  headline: string | null;
  ad_id: string | null;
  body: string | null;
  source_type: string | null;
  source_url: string | null;
}

export function parseCtwaReferral(message: unknown): CtwaReferral | null {
  if (!message || typeof message !== 'object') return null;
  const referral = (message as { referral?: unknown }).referral;
  if (!referral || typeof referral !== 'object') return null;
  const r = referral as Record<string, unknown>;
  const adsContext =
    r.ads_context_data && typeof r.ads_context_data === 'object'
      ? (r.ads_context_data as Record<string, unknown>)
      : null;

  const source_id =
    typeof r.source_id === 'string' && r.source_id ? r.source_id : null;
  const ctwa_clid =
    typeof r.ctwa_clid === 'string' && r.ctwa_clid ? r.ctwa_clid : null;
  const headline =
    typeof r.headline === 'string' && r.headline
      ? r.headline
      : typeof adsContext?.ad_title === 'string'
        ? adsContext.ad_title
        : null;
  const ad_id =
    typeof r.ad_id === 'string' && r.ad_id
      ? r.ad_id
      : typeof adsContext?.ad_id === 'string'
        ? adsContext.ad_id
        : source_id;
  const body = typeof r.body === 'string' && r.body ? r.body : null;
  const source_type =
    typeof r.source_type === 'string' && r.source_type ? r.source_type : null;
  const source_url =
    typeof r.source_url === 'string' && r.source_url ? r.source_url : null;

  if (!source_id && !ctwa_clid && !ad_id && !headline) return null;

  return {
    source_id,
    ctwa_clid,
    headline,
    ad_id,
    body,
    source_type,
    source_url,
  };
}

export function ctwaColumns(referral: CtwaReferral, at = new Date()) {
  return {
    ctwa_source_id: referral.source_id,
    ctwa_clid: referral.ctwa_clid,
    ctwa_headline: referral.headline,
    ctwa_ad_id: referral.ad_id,
    ctwa_body: referral.body,
    ctwa_source_type: referral.source_type,
    ctwa_source_url: referral.source_url,
    ctwa_captured_at: at.toISOString(),
  };
}

export interface AdAttributionRow {
  source_id: string | null;
  ad_id: string | null;
  headline: string | null;
  conversations: number;
  conversions: number;
}

/** Aggregate attribution rows into per-ad report lines. */
export function aggregateAdReport(
  rows: Array<{
    source_id: string | null;
    ad_id: string | null;
    headline: string | null;
    converted_at: string | null;
  }>,
): AdAttributionRow[] {
  const map = new Map<string, AdAttributionRow>();
  for (const row of rows) {
    const key = `${row.ad_id ?? ''}|${row.source_id ?? ''}|${row.headline ?? ''}`;
    const existing = map.get(key) ?? {
      source_id: row.source_id,
      ad_id: row.ad_id,
      headline: row.headline,
      conversations: 0,
      conversions: 0,
    };
    existing.conversations += 1;
    if (row.converted_at) existing.conversions += 1;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.conversations - a.conversations);
}

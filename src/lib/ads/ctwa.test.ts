import { describe, expect, it } from 'vitest';

import {
  aggregateAdReport,
  ctwaColumns,
  parseCtwaReferral,
} from './ctwa';

const FIXTURE_REFERRAL = {
  id: 'wamid.CTWA1',
  from: '919876543210',
  timestamp: '1700000000',
  type: 'text',
  text: { body: 'Hi from the ad' },
  referral: {
    source_url: 'https://fb.me/ad',
    source_type: 'ad',
    source_id: '120212345678901234',
    headline: 'Summer sale — chat now',
    body: 'Get 20% off',
    media_type: 'image',
    ctwa_clid: 'ARAbCdEfGhIjKlMn',
    ads_context_data: {
      ad_id: '23851234567890123',
      ad_title: 'Summer sale — chat now',
    },
  },
};

describe('parseCtwaReferral', () => {
  it('extracts Meta CTWA referral fields from fixture', () => {
    const parsed = parseCtwaReferral(FIXTURE_REFERRAL);
    expect(parsed).toEqual({
      source_id: '120212345678901234',
      ctwa_clid: 'ARAbCdEfGhIjKlMn',
      headline: 'Summer sale — chat now',
      ad_id: '23851234567890123',
      body: 'Get 20% off',
      source_type: 'ad',
      source_url: 'https://fb.me/ad',
    });
  });

  it('returns null when referral is absent', () => {
    expect(parseCtwaReferral({ type: 'text', text: { body: 'hi' } })).toBeNull();
  });

  it('falls back to source_id as ad_id', () => {
    const parsed = parseCtwaReferral({
      referral: { source_id: 'src_only', source_type: 'ad' },
    });
    expect(parsed?.ad_id).toBe('src_only');
  });
});

describe('ctwaColumns + aggregateAdReport', () => {
  it('maps columns for DB update', () => {
    const parsed = parseCtwaReferral(FIXTURE_REFERRAL)!;
    const cols = ctwaColumns(parsed, new Date('2024-01-01T00:00:00.000Z'));
    expect(cols.ctwa_clid).toBe('ARAbCdEfGhIjKlMn');
    expect(cols.ctwa_captured_at).toBe('2024-01-01T00:00:00.000Z');
  });

  it('aggregates conversations and conversions per ad', () => {
    const report = aggregateAdReport([
      {
        source_id: 's1',
        ad_id: 'a1',
        headline: 'Sale',
        converted_at: '2024-01-02T00:00:00Z',
      },
      {
        source_id: 's1',
        ad_id: 'a1',
        headline: 'Sale',
        converted_at: null,
      },
      {
        source_id: 's2',
        ad_id: 'a2',
        headline: 'Other',
        converted_at: null,
      },
    ]);
    expect(report[0]).toMatchObject({
      ad_id: 'a1',
      conversations: 2,
      conversions: 1,
    });
    expect(report[1].conversations).toBe(1);
  });
});

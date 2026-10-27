import { describe, expect, it } from 'vitest';

import {
  LEGACY_HEADERS_UNTIL,
  buildWebhookDeliveryHeaders,
  legacyWebhookHeadersEnabled,
} from '@/lib/webhooks/delivery-headers';

describe('legacyWebhookHeadersEnabled', () => {
  it('honours WEBHOOK_LEGACY_HEADERS=0', () => {
    expect(
      legacyWebhookHeadersEnabled({ WEBHOOK_LEGACY_HEADERS: '0' }, new Date()),
    ).toBe(false);
  });

  it('honours WEBHOOK_LEGACY_HEADERS=1 even past the window', () => {
    expect(
      legacyWebhookHeadersEnabled(
        { WEBHOOK_LEGACY_HEADERS: '1' },
        new Date('2099-01-01T00:00:00Z'),
      ),
    ).toBe(true);
  });

  it(`defaults on through ${LEGACY_HEADERS_UNTIL}`, () => {
    expect(
      legacyWebhookHeadersEnabled({}, new Date(`${LEGACY_HEADERS_UNTIL}T12:00:00Z`)),
    ).toBe(true);
  });

  it('defaults off after the dual-send window', () => {
    expect(
      legacyWebhookHeadersEnabled({}, new Date('2026-11-27T00:00:00Z')),
    ).toBe(false);
  });
});

describe('buildWebhookDeliveryHeaders', () => {
  const base = {
    event: 'message.received',
    webhookId: 'wh_1',
    rawBody: '{"ok":true}',
    secret: 'sekrit',
    tsSeconds: 1_700_000_000,
  };

  it('always sends X-Astra-* and optionally dual-sends X-Wacrm-*', () => {
    const withLegacy = buildWebhookDeliveryHeaders({
      ...base,
      includeLegacy: true,
    });
    expect(withLegacy['X-Astra-Event']).toBe('message.received');
    expect(withLegacy['X-Astra-Webhook-Id']).toBe('wh_1');
    expect(withLegacy['X-Astra-Signature']).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(withLegacy['X-Wacrm-Event']).toBe(withLegacy['X-Astra-Event']);
    expect(withLegacy['X-Wacrm-Webhook-Id']).toBe(withLegacy['X-Astra-Webhook-Id']);
    expect(withLegacy['X-Wacrm-Signature']).toBe(withLegacy['X-Astra-Signature']);

    const without = buildWebhookDeliveryHeaders({
      ...base,
      includeLegacy: false,
    });
    expect(without['X-Wacrm-Event']).toBeUndefined();
    expect(without['X-Wacrm-Signature']).toBeUndefined();
  });
});

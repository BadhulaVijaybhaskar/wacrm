import { describe, expect, it } from 'vitest';

import {
  extractCustomerPhone,
  mapShopifyTopic,
  mapWooTopic,
} from './orders';

describe('commerce topic + phone mapping', () => {
  it('maps Shopify and Woo topics', () => {
    expect(mapShopifyTopic('orders/create')).toBe('order.created');
    expect(mapShopifyTopic('orders/fulfilled')).toBe('order.fulfilled');
    expect(mapShopifyTopic('checkouts/update')).toBe('order.abandoned_checkout');
    expect(mapWooTopic('order.cancelled')).toBe('order.cancelled');
    expect(mapShopifyTopic('unknown')).toBeNull();
  });

  it('normalises IN phones from payloads', () => {
    expect(
      extractCustomerPhone('shopify', { phone: '9876543210' }),
    ).toBe('+919876543210');
    expect(
      extractCustomerPhone('woocommerce', {
        billing: { phone: '+14155550123' },
      }),
    ).toBe('+14155550123');
  });
});

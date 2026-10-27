import { afterEach, describe, expect, it } from 'vitest';

import { isIntegrationsStubMode, testProviderConnection } from './stub';

describe('integrations stub', () => {
  const prevMeta = process.env.META_STUB;
  const prevInt = process.env.INTEGRATIONS_STUB;

  afterEach(() => {
    if (prevMeta === undefined) delete process.env.META_STUB;
    else process.env.META_STUB = prevMeta;
    if (prevInt === undefined) delete process.env.INTEGRATIONS_STUB;
    else process.env.INTEGRATIONS_STUB = prevInt;
  });

  it('treats NODE_ENV=test as stub mode', () => {
    delete process.env.META_STUB;
    delete process.env.INTEGRATIONS_STUB;
    expect(isIntegrationsStubMode()).toBe(true);
  });

  it('passes shopify stub when required fields present', () => {
    process.env.META_STUB = '1';
    const result = testProviderConnection('shopify', {
      shop_domain: 'demo.myshopify.com',
      webhook_secret: 'whsec_test',
    });
    expect(result.ok).toBe(true);
    expect(result.stub).toBe(true);
  });

  it('fails stub when required fields missing', () => {
    process.env.INTEGRATIONS_STUB = '1';
    const result = testProviderConnection('stripe', {});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Missing fields/);
  });
});

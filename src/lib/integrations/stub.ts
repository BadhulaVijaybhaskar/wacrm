/**
 * Stub / sandbox mode for third-party connector tests.
 * Never hits live provider APIs from unit tests or META_STUB staging.
 */

import type { IntegrationProvider } from './catalog';
import type { CredentialBag } from './credentials';

function envFlagOn(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** True when connectors must use mocks (tests, META_STUB, INTEGRATIONS_STUB). */
export function isIntegrationsStubMode(): boolean {
  return (
    envFlagOn('INTEGRATIONS_STUB') ||
    envFlagOn('META_STUB') ||
    process.env.NODE_ENV === 'test'
  );
}

export interface ConnectionTestResult {
  ok: boolean;
  stub: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Provider-shaped connection test. In stub mode always succeeds when
 * required-looking fields are present; never dials the network.
 */
export function testProviderConnection(
  provider: IntegrationProvider,
  credentials: CredentialBag,
): ConnectionTestResult {
  const stub = isIntegrationsStubMode();

  if (!stub) {
    // Live path is filled in by later CHAT tasks. Until then refuse
    // rather than accidentally calling third parties.
    return {
      ok: false,
      stub: false,
      message:
        'Live provider tests are not enabled. Set META_STUB=1 or INTEGRATIONS_STUB=1, or complete the provider client for this connector.',
    };
  }

  const requiredPresence: Partial<Record<IntegrationProvider, string[]>> = {
    outbound_webhooks: ['default_url'],
    shopify: ['shop_domain', 'webhook_secret'],
    woocommerce: ['store_url', 'webhook_secret'],
    razorpay: ['key_id', 'key_secret'],
    stripe: ['secret_key'],
    google_sheets: ['client_id', 'client_secret'],
    hubspot: ['access_token'],
    zoho: ['client_id', 'client_secret', 'refresh_token'],
    astra_crm: ['webhook_url', 'signing_secret'],
    instagram: ['page_id', 'page_access_token'],
    messenger: ['page_id', 'page_access_token'],
  };

  const need = requiredPresence[provider] ?? [];
  const missing = need.filter((k) => !credentials[k]?.trim());
  if (missing.length > 0) {
    return {
      ok: false,
      stub: true,
      message: `Missing fields for stub test: ${missing.join(', ')}`,
      details: { missing },
    };
  }

  return {
    ok: true,
    stub: true,
    message: `Stub OK for ${provider}`,
    details: {
      provider,
      checked_at: new Date().toISOString(),
      keys: Object.keys(credentials),
    },
  };
}

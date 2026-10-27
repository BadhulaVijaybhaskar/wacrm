/**
 * Integrations hub catalog — providers shown under Settings → Integrations.
 * Connect/test/disconnect are implemented against encrypted storage + stubs;
 * live provider clients land in later CHAT tasks.
 */

export const INTEGRATION_CATEGORIES = [
  'automation',
  'commerce',
  'payments',
  'spreadsheets',
  'crm',
  'messaging',
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export const INTEGRATION_PROVIDERS = [
  'outbound_webhooks',
  'zapier',
  'make',
  'shopify',
  'woocommerce',
  'razorpay',
  'stripe',
  'google_sheets',
  'hubspot',
  'zoho',
  'astra_crm',
  'instagram',
  'messenger',
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export type IntegrationConnectionStatus =
  | 'disconnected'
  | 'connected'
  | 'error';

export interface IntegrationCredentialField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  required?: boolean;
}

export interface IntegrationProviderMeta {
  id: IntegrationProvider;
  name: string;
  description: string;
  category: IntegrationCategory;
  /** Non-secret + secret fields collected on Connect. */
  fields: ReadonlyArray<IntegrationCredentialField>;
  docsHint?: string;
}

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  automation: 'Automation & webhooks',
  commerce: 'Commerce',
  payments: 'Payments',
  spreadsheets: 'Spreadsheets',
  crm: 'CRM',
  messaging: 'Social messaging',
};

export const INTEGRATION_CATALOG: ReadonlyArray<IntegrationProviderMeta> = [
  {
    id: 'outbound_webhooks',
    name: 'Outbound webhooks',
    description: 'Push events to your HTTPS endpoints with HMAC signatures.',
    category: 'automation',
    fields: [
      {
        key: 'default_url',
        label: 'Sample endpoint URL',
        placeholder: 'https://hooks.example.com/astra',
        required: true,
      },
    ],
    docsHint: 'Uses the existing webhook_endpoints table for deliveries.',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'REST Hooks subscribe/unsubscribe compatible with Zapier.',
    category: 'automation',
    fields: [
      {
        key: 'hook_url',
        label: 'Zapier catch hook (optional)',
        placeholder: 'https://hooks.zapier.com/...',
      },
    ],
  },
  {
    id: 'make',
    name: 'Make',
    description: 'Make.com (Integromat) custom webhook scenarios.',
    category: 'automation',
    fields: [
      {
        key: 'hook_url',
        label: 'Make webhook URL (optional)',
        placeholder: 'https://hook.eu1.make.com/...',
      },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Order and abandoned-checkout events → WhatsApp templates.',
    category: 'commerce',
    fields: [
      { key: 'shop_domain', label: 'Shop domain', placeholder: 'mystore.myshopify.com', required: true },
      { key: 'webhook_secret', label: 'Webhook signing secret', secret: true, required: true },
      { key: 'admin_token', label: 'Admin API token', secret: true },
    ],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    description: 'Woo order webhooks with shared-secret verification.',
    category: 'commerce',
    fields: [
      { key: 'store_url', label: 'Store URL', placeholder: 'https://shop.example.com', required: true },
      { key: 'webhook_secret', label: 'Webhook secret', secret: true, required: true },
      { key: 'consumer_key', label: 'Consumer key', secret: true },
      { key: 'consumer_secret', label: 'Consumer secret', secret: true },
    ],
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    description: 'Create payment links in chat and track status webhooks.',
    category: 'payments',
    fields: [
      { key: 'key_id', label: 'Key ID', required: true },
      { key: 'key_secret', label: 'Key secret', secret: true, required: true },
      { key: 'webhook_secret', label: 'Webhook secret', secret: true },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment links and checkout status updates in the timeline.',
    category: 'payments',
    fields: [
      { key: 'secret_key', label: 'Secret key', secret: true, required: true },
      { key: 'webhook_secret', label: 'Webhook signing secret', secret: true },
      { key: 'publishable_key', label: 'Publishable key' },
    ],
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    description: 'Import/export contacts with column mapping and scheduled sync.',
    category: 'spreadsheets',
    fields: [
      { key: 'client_id', label: 'OAuth client ID', required: true },
      { key: 'client_secret', label: 'OAuth client secret', secret: true, required: true },
      { key: 'spreadsheet_id', label: 'Default spreadsheet ID' },
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Push contacts and conversation notes; de-dupe by phone/email.',
    category: 'crm',
    fields: [
      { key: 'access_token', label: 'Private app token', secret: true, required: true },
    ],
  },
  {
    id: 'zoho',
    name: 'Zoho CRM',
    description: 'Push contacts and notes into Zoho with field mapping.',
    category: 'crm',
    fields: [
      { key: 'client_id', label: 'Client ID', required: true },
      { key: 'client_secret', label: 'Client secret', secret: true, required: true },
      { key: 'refresh_token', label: 'Refresh token', secret: true, required: true },
      { key: 'api_domain', label: 'API domain', placeholder: 'https://www.zohoapis.in' },
    ],
  },
  {
    id: 'astra_crm',
    name: 'Astra CRM',
    description: 'Frappe CRM–compatible signed webhook to your Astra CRM URL.',
    category: 'crm',
    fields: [
      { key: 'webhook_url', label: 'CRM webhook URL', required: true },
      { key: 'signing_secret', label: 'Signing secret', secret: true, required: true },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram DM',
    description: 'Instagram Direct in the unified inbox (Meta stub in tests).',
    category: 'messaging',
    fields: [
      { key: 'page_id', label: 'Page / IG business ID', required: true },
      { key: 'page_access_token', label: 'Page access token', secret: true, required: true },
    ],
  },
  {
    id: 'messenger',
    name: 'Facebook Messenger',
    description: 'Messenger threads in the same inbox as WhatsApp.',
    category: 'messaging',
    fields: [
      { key: 'page_id', label: 'Page ID', required: true },
      { key: 'page_access_token', label: 'Page access token', secret: true, required: true },
    ],
  },
];

export function getProviderMeta(
  id: string,
): IntegrationProviderMeta | undefined {
  return INTEGRATION_CATALOG.find((p) => p.id === id);
}

export function isIntegrationProvider(id: string): id is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(id);
}

export function providersByCategory(
  category: IntegrationCategory,
): ReadonlyArray<IntegrationProviderMeta> {
  return INTEGRATION_CATALOG.filter((p) => p.category === category);
}

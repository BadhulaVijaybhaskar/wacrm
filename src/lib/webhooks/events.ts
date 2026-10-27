// ============================================================
// Outbound webhook event vocabulary — pure, no I/O.
//
// An endpoint subscribes to one or more of these. Adding an event is
// one entry here plus a `dispatchWebhookEvent` call at the source of
// the event (the DB stores subscriptions as a free `text[]`, so no
// migration is needed — same model as API scopes).
// ============================================================

export const WEBHOOK_EVENTS = [
  // Messages
  'message.received',
  'message.sent',
  'message.status',
  // legacy alias kept for existing subscribers
  'message.status_updated',
  // Contacts
  'contact.created',
  'contact.updated',
  // Conversations
  'conversation.created',
  'conversation.assigned',
  'conversation.closed',
  // Consent
  'optout',
  // Commerce (Shopify/Woo → automations)
  'order.created',
  'order.fulfilled',
  'order.cancelled',
  'order.abandoned_checkout',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Human-readable descriptions (Settings UI + public docs). */
export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  'message.received': 'An inbound message was received from a contact',
  'message.sent': 'An outbound message was accepted for delivery',
  'message.status':
    'A message delivery status changed (sent/delivered/read/failed)',
  'message.status_updated':
    'Legacy alias of message.status (kept for existing subscriptions)',
  'contact.created': 'A contact was created',
  'contact.updated': 'A contact was updated',
  'conversation.created': 'A new conversation was opened',
  'conversation.assigned': 'A conversation was assigned to a teammate',
  'conversation.closed': 'A conversation was closed',
  optout: 'A contact opted out (STOP / UNSUBSCRIBE) or back in',
  'order.created': 'An ecommerce order was created',
  'order.fulfilled': 'An ecommerce order was fulfilled',
  'order.cancelled': 'An ecommerce order was cancelled',
  'order.abandoned_checkout': 'A shopper abandoned checkout',
};

/** Type-narrow an unknown value into a valid `WebhookEvent`. */
export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return (
    typeof value === 'string' &&
    (WEBHOOK_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * Validate + de-duplicate a caller-supplied event list. Returns the
 * cleaned list, or `null` if any entry is unknown (callers turn that
 * into a 400). An empty list is rejected as `null` too — an endpoint
 * subscribed to nothing is almost certainly a mistake.
 */
export function normalizeEvents(input: unknown): WebhookEvent[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: WebhookEvent[] = [];
  for (const entry of input) {
    if (!isWebhookEvent(entry)) return null;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

/** Sample `data` payloads for docs / Zapier perform-list. */
export function samplePayloadForEvent(event: WebhookEvent): Record<string, unknown> {
  const base = {
    account_id: 'acct_sample',
    occurred_at: '2026-10-27T12:00:00.000Z',
  };
  switch (event) {
    case 'message.received':
      return {
        ...base,
        conversation_id: 'conv_sample',
        contact_id: 'ct_sample',
        message_id: 'msg_sample',
        text: 'Hello from WhatsApp',
        from: '+919876543210',
      };
    case 'message.sent':
      return {
        ...base,
        conversation_id: 'conv_sample',
        message_id: 'msg_out',
        text: 'Thanks — see you Tue 3pm',
        to: '+919876543210',
      };
    case 'message.status':
    case 'message.status_updated':
      return {
        ...base,
        message_id: 'msg_out',
        status: 'delivered',
        timestamp: '2026-10-27T12:01:00.000Z',
      };
    case 'contact.created':
    case 'contact.updated':
      return {
        ...base,
        contact_id: 'ct_sample',
        name: 'Priya Sharma',
        phone: '+919876543210',
        email: 'priya@example.com',
      };
    case 'conversation.created':
    case 'conversation.assigned':
    case 'conversation.closed':
      return {
        ...base,
        conversation_id: 'conv_sample',
        contact_id: 'ct_sample',
        assignee_id: event === 'conversation.assigned' ? 'user_sample' : null,
        status: event === 'conversation.closed' ? 'closed' : 'open',
      };
    case 'optout':
      return {
        ...base,
        contact_id: 'ct_sample',
        phone: '+919876543210',
        action: 'opt_out',
        keyword: 'STOP',
      };
    case 'order.created':
    case 'order.fulfilled':
    case 'order.cancelled':
    case 'order.abandoned_checkout':
      return {
        ...base,
        order_id: 'ord_1001',
        provider: 'shopify',
        total: '1499.00',
        currency: 'INR',
        customer_phone: '+919876543210',
        status: event.split('.')[1],
      };
    default:
      return base;
  }
}

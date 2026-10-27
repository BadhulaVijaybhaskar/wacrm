import { describe, expect, it } from 'vitest';

import {
  WEBHOOK_EVENTS,
  samplePayloadForEvent,
  WEBHOOK_EVENT_DESCRIPTIONS,
} from './events';

describe('webhook event catalog (CHAT-17)', () => {
  it('includes commerce, consent and conversation lifecycle events', () => {
    for (const required of [
      'message.sent',
      'message.status',
      'contact.created',
      'conversation.assigned',
      'optout',
      'order.created',
      'order.abandoned_checkout',
    ] as const) {
      expect(WEBHOOK_EVENTS).toContain(required);
      expect(WEBHOOK_EVENT_DESCRIPTIONS[required]).toBeTruthy();
      expect(samplePayloadForEvent(required)).toBeTruthy();
    }
  });
});

/**
 * Sample webhook payload for Zapier perform-list / docs.
 * GET /api/v1/hooks/sample?event=message.received
 */

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  isWebhookEvent,
  samplePayloadForEvent,
  WEBHOOK_EVENT_DESCRIPTIONS,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from '@/lib/webhooks/events';

export async function GET(request: Request) {
  try {
    await requireApiKey(request, 'webhooks:manage');
    const url = new URL(request.url);
    const raw = url.searchParams.get('event') ?? 'message.received';
    if (!isWebhookEvent(raw)) {
      return fail(
        'bad_request',
        `Unknown event. Known: ${WEBHOOK_EVENTS.join(', ')}`,
        400,
      );
    }
    const event = raw as WebhookEvent;
    return ok({
      event,
      description: WEBHOOK_EVENT_DESCRIPTIONS[event],
      sample: {
        id: 'evt_sample',
        event,
        occurred_at: '2026-10-27T12:00:00.000Z',
        account_id: 'acct_sample',
        data: samplePayloadForEvent(event),
      },
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

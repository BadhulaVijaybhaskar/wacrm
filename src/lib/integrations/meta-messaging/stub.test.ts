import { describe, expect, it } from 'vitest';

import {
  parseMetaMessagingPayload,
  sendMetaMessagingMessage,
} from './stub';

describe('meta messaging stub', () => {
  it('parses messenger and instagram objects', () => {
    const events = parseMetaMessagingPayload({
      object: 'page',
      entry: [
        {
          id: 'page1',
          messaging: [
            {
              sender: { id: 'user1' },
              message: { mid: 'm1', text: 'Hello' },
            },
          ],
        },
      ],
    });
    expect(events).toEqual([
      {
        channel: 'messenger',
        pageId: 'page1',
        senderId: 'user1',
        text: 'Hello',
        mid: 'm1',
      },
    ]);

    const ig = parseMetaMessagingPayload({
      object: 'instagram',
      entry: [
        {
          id: 'ig1',
          messaging: [
            {
              sender: { id: 'ig_user' },
              message: { mid: 'igm1', text: 'Hi IG' },
            },
          ],
        },
      ],
    });
    expect(ig[0]?.channel).toBe('instagram');
  });

  it('sends stub outbound ids', async () => {
    process.env.META_STUB = '1';
    const res = await sendMetaMessagingMessage({
      channel: 'instagram',
      pageAccessToken: 'tok',
      recipientId: 'u1',
      text: 'hi',
    });
    expect(res.stub).toBe(true);
    expect(res.messageId).toMatch(/^instagram_stub_/);
  });
});

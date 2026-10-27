/**
 * Instagram / Messenger send + inbound parse — META_STUB only.
 */

import { isMetaStubMode } from '@/lib/whatsapp/embedded-signup';
import type { MessagingChannel } from '@/types';

export function isMetaMessagingStub(): boolean {
  return isMetaStubMode() || process.env.NODE_ENV === 'test';
}

export interface ParsedMetaMessagingEvent {
  channel: Exclude<MessagingChannel, 'whatsapp'>;
  pageId: string;
  senderId: string;
  text: string;
  mid: string;
}

export function parseMetaMessagingPayload(
  body: unknown,
): ParsedMetaMessagingEvent[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as {
    object?: string;
    entry?: Array<{
      id?: string;
      messaging?: Array<{
        sender?: { id?: string };
        message?: { mid?: string; text?: string };
      }>;
    }>;
  };
  const channel: Exclude<MessagingChannel, 'whatsapp'> | null =
    root.object === 'instagram'
      ? 'instagram'
      : root.object === 'page'
        ? 'messenger'
        : null;
  if (!channel) return [];

  const out: ParsedMetaMessagingEvent[] = [];
  for (const entry of root.entry ?? []) {
    for (const msg of entry.messaging ?? []) {
      const text = msg.message?.text?.trim();
      const senderId = msg.sender?.id;
      const mid = msg.message?.mid;
      if (!text || !senderId || !mid) continue;
      out.push({
        channel,
        pageId: entry.id ?? 'page',
        senderId,
        text,
        mid,
      });
    }
  }
  return out;
}

export async function sendMetaMessagingMessage(opts: {
  channel: Exclude<MessagingChannel, 'whatsapp'>;
  pageAccessToken: string;
  recipientId: string;
  text: string;
}): Promise<{ messageId: string; stub: boolean }> {
  if (!isMetaMessagingStub()) {
    throw new Error(
      'Live Instagram/Messenger send is only available under META_STUB',
    );
  }
  void opts.pageAccessToken;
  return {
    messageId: `${opts.channel}_stub_${Date.now()}`,
    stub: true,
  };
}

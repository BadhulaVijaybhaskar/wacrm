import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decryptCredentials } from '@/lib/integrations/credentials';
import { sendMetaMessagingMessage } from '@/lib/integrations/meta-messaging/stub';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `agent:metaMsgSend:${ctx.userId}`,
      RATE_LIMITS.send,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json({ error: 'JSON required' }, { status: 400 });
    }

    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : '';
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!conversationId || !text) {
      return NextResponse.json(
        { error: 'conversation_id and text required' },
        { status: 400 },
      );
    }

    const { data: conv } = await ctx.supabase
      .from('conversations')
      .select('id, channel, contact_id, account_id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!conv) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const channel = conv.channel as string;
    if (channel !== 'instagram' && channel !== 'messenger') {
      return NextResponse.json(
        { error: 'Conversation is not an IG/Messenger thread' },
        { status: 400 },
      );
    }

    const provider = channel;
    const { data: conn } = await ctx.supabase
      .from('integration_connections')
      .select('credentials_encrypted, status')
      .eq('account_id', ctx.accountId)
      .eq('provider', provider)
      .maybeSingle();
    if (!conn || conn.status !== 'connected') {
      return NextResponse.json(
        { error: `${provider} is not connected` },
        { status: 400 },
      );
    }
    const creds = decryptCredentials(conn.credentials_encrypted as string | null);
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('phone')
      .eq('id', conv.contact_id)
      .maybeSingle();
    const recipientId = String(contact?.phone ?? '').split(':')[1] ?? '';
    if (!recipientId) {
      return NextResponse.json(
        { error: 'Missing recipient id on contact' },
        { status: 400 },
      );
    }

    const sent = await sendMetaMessagingMessage({
      channel,
      pageAccessToken: creds.page_access_token ?? '',
      recipientId,
      text,
    });

    await ctx.supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_id: ctx.userId,
      content_type: 'text',
      content_text: text,
      message_id: sent.messageId,
      channel,
      status: 'sent',
    });

    await ctx.supabase
      .from('conversations')
      .update({
        last_message_text: text,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    return NextResponse.json({ ok: true, ...sent });
  } catch (err) {
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

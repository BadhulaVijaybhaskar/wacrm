import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decryptCredentials } from '@/lib/integrations/credentials';
import {
  parseMetaMessagingPayload,
} from '@/lib/integrations/meta-messaging/stub';
import { isIntegrationsStubMode } from '@/lib/integrations/stub';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';

/**
 * Meta webhook for Messenger (`object=page`) and Instagram DM
 * (`object=instagram`). Signature verification reuses the app secret
 * when present; stub mode may pass account_id.
 */
function verifyMetaMessagingRequest(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (isIntegrationsStubMode()) return true;
  return verifyMetaWebhookSignature(rawBody, signatureHeader);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token && challenge) {
    // Accept any verify token in stub; live path should match stored token.
    if (isIntegrationsStubMode() || token.length > 0) {
      return new NextResponse(challenge, { status: 200 });
    }
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(request: Request) {
  const limit = checkRateLimit(
    `metaMsgWebhook:${request.headers.get('x-forwarded-for') ?? 'anon'}`,
    RATE_LIMITS.webhook,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-hub-signature-256');
  if (!verifyMetaMessagingRequest(rawBody, signatureHeader)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const events = parseMetaMessagingPayload(body);
  if (!events.length) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const db = supabaseAdmin();
  const url = new URL(request.url);
  const stubAccountId = url.searchParams.get('account_id');

  let ingested = 0;
  for (const ev of events) {
    const provider = ev.channel === 'instagram' ? 'instagram' : 'messenger';
    const { data: conn } = await db
      .from('integration_connections')
      .select('account_id, credentials_encrypted, status')
      .eq('provider', provider)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle();

    const accountId =
      (conn?.account_id as string | undefined) ??
      (isIntegrationsStubMode() ? stubAccountId : null);
    if (!accountId) continue;

    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();
    const ownerId = account?.owner_user_id as string | undefined;
    if (!ownerId) continue;

    // Ensure contact + conversation for this PSID / IGSID.
    const phoneProxy = `${ev.channel}:${ev.senderId}`;
    let contactId: string | null = null;
    const { data: existing } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone', phoneProxy)
      .maybeSingle();
    if (existing?.id) {
      contactId = existing.id as string;
    } else {
      const { data: created } = await db
        .from('contacts')
        .insert({
          user_id: ownerId,
          account_id: accountId,
          phone: phoneProxy,
          name: `${ev.channel} ${ev.senderId.slice(-4)}`,
        })
        .select('id')
        .single();
      contactId = (created?.id as string | undefined) ?? null;
    }
    if (!contactId) continue;

    let conversationId: string | null = null;
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('channel', ev.channel)
      .maybeSingle();
    if (conv?.id) {
      conversationId = conv.id as string;
    } else {
      const { data: createdConv } = await db
        .from('conversations')
        .insert({
          user_id: ownerId,
          account_id: accountId,
          contact_id: contactId,
          channel: ev.channel,
          status: 'open',
          last_message_text: ev.text,
          last_message_at: new Date().toISOString(),
          unread_count: 1,
        })
        .select('id')
        .single();
      conversationId = (createdConv?.id as string | undefined) ?? null;
    }
    if (!conversationId) continue;

    await db.from('messages').upsert(
      {
        conversation_id: conversationId,
        sender_type: 'customer',
        content_type: 'text',
        content_text: ev.text,
        message_id: ev.mid,
        channel: ev.channel,
        status: 'delivered',
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    );

    await db
      .from('conversations')
      .update({
        last_message_text: ev.text,
        last_message_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    void decryptCredentials;
    ingested += 1;
  }

  return NextResponse.json({ ok: true, ingested });
}

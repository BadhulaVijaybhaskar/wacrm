#!/usr/bin/env node
/**
 * Seed demo CRM rows for staging / local throwaway Supabase.
 *
 * Does NOT create auth.users — pass an existing account + owner user:
 *
 *   SEED_ACCOUNT_ID=… SEED_USER_ID=… \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   node deploy/staging/scripts/seed-demo-data.mjs
 *
 * Shared-project (schema wacrm) — also honour:
 *   SUPABASE_DB_SCHEMA / NEXT_PUBLIC_SUPABASE_DB_SCHEMA   (default public)
 *   STORAGE_BUCKET_PREFIX / NEXT_PUBLIC_STORAGE_BUCKET_PREFIX  (default '')
 *
 * Optionally renames the profile (and auth email when possible) to the
 * demo agent identity below so screens show "Demo Agent" / demo@….
 *
 * Flags:
 *   --dry-run   print the payload and exit 0 (no network)
 *   --help
 *
 * Idempotent: contacts keyed by phone; tags by name; conversation by
 * contact; broadcast by name. Safe to re-run.
 */
'use strict';

import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

/** Resolve Chat DB schema for the Supabase JS client (`db.schema`). */
export function resolveSeedDbSchema(env = process.env) {
  const raw = (
    env.SUPABASE_DB_SCHEMA ?? env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA
  )?.trim();
  return raw && raw.length > 0 ? raw : 'public';
}

/** Resolve storage bucket id prefix (`wacrm-` on shared projects). */
export function resolveSeedStorageBucketPrefix(env = process.env) {
  if (env.STORAGE_BUCKET_PREFIX !== undefined) {
    return env.STORAGE_BUCKET_PREFIX;
  }
  if (env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX !== undefined) {
    return env.NEXT_PUBLIC_STORAGE_BUCKET_PREFIX;
  }
  return '';
}

/** Logical Chat bucket → deployed Storage id. */
export function resolveSeedStorageBucket(logicalName, env = process.env) {
  return `${resolveSeedStorageBucketPrefix(env)}${logicalName}`;
}

export const DEMO_AGENT = Object.freeze({
  fullName: 'Demo Agent',
  email: 'demo@astraconnect.io',
});

export const DEMO_TAG = {
  name: 'VIP',
  color: '#145CF6',
};

export const DEMO_NOTE =
  'Interested in the enterprise plan — follow up after Thursday’s product walkthrough.';

/** Eight contacts; first five get open conversations. */
export const DEMO_CONTACTS = Object.freeze([
  {
    phone: '+15550100001',
    name: 'Priya Sharma',
    email: 'priya.sharma@northwind.example',
    company: 'Northwind Retail',
    withConversation: true,
    handoff: 'ai',
    lastMessage: 'Perfect — see you then.',
    messages: [
      { sender: 'customer', text: 'Hi — can we schedule a demo tomorrow?' },
      { sender: 'agent', text: 'Absolutely. Does 11:00 IST work?' },
      { sender: 'customer', text: 'Perfect — see you then.' },
    ],
  },
  {
    phone: '+15550100002',
    name: 'Jordan Lee',
    email: 'jordan.lee@brightline.example',
    company: 'Brightline Logistics',
    withConversation: true,
    handoff: 'human',
    lastMessage: 'Thanks — I’ll wait for your callback.',
    messages: [
      {
        sender: 'customer',
        text: 'The AI bot couldn’t answer my billing question.',
      },
      {
        sender: 'agent',
        text: 'I’ve taken this over — happy to help with billing.',
      },
      { sender: 'customer', text: 'Thanks — I’ll wait for your callback.' },
    ],
  },
  {
    phone: '+15550100003',
    name: 'Amelia Chen',
    email: 'amelia.chen@harbor.example',
    company: 'Harbor Clinics',
    withConversation: true,
    handoff: 'ai',
    lastMessage: 'Could you send the clinic hours?',
    messages: [
      { sender: 'customer', text: 'Could you send the clinic hours?' },
      {
        sender: 'bot',
        text: 'We’re open Mon–Fri 9:00–18:00. Anything else I can help with?',
      },
    ],
  },
  {
    phone: '+15550100004',
    name: 'Marcus Okonkwo',
    email: 'marcus@oakstreet.example',
    company: 'Oak Street Goods',
    withConversation: true,
    handoff: 'ai',
    lastMessage: 'Order #4821 arrived damaged.',
    messages: [
      { sender: 'customer', text: 'Order #4821 arrived damaged.' },
      {
        sender: 'agent',
        text: 'Sorry about that — I’ll open a replacement shipment today.',
      },
    ],
  },
  {
    phone: '+15550100005',
    name: 'Sofia Reyes',
    email: 'sofia.reyes@lumen.example',
    company: 'Lumen Design Studio',
    withConversation: true,
    handoff: 'ai',
    lastMessage: 'Looking forward to the kickoff call.',
    messages: [
      { sender: 'customer', text: 'Looking forward to the kickoff call.' },
    ],
  },
  {
    phone: '+15550100006',
    name: 'Noah Patel',
    email: 'noah.patel@cedar.example',
    company: 'Cedar Finance',
    withConversation: false,
  },
  {
    phone: '+15550100007',
    name: 'Elena Rossi',
    email: 'elena.rossi@atelier.example',
    company: 'Atelier Rossi',
    withConversation: false,
  },
  {
    phone: '+15550100008',
    name: 'Kenji Watanabe',
    email: 'kenji@sakura.example',
    company: 'Sakura Imports',
    withConversation: false,
  },
]);

export const DEMO_BROADCAST = Object.freeze({
  name: 'Spring welcome offer',
  template_name: 'welcome_offer',
  template_language: 'en',
  status: 'sent',
});

/** Gap between seeded message bubbles (and contact thread offsets). */
export const SEED_STEP_MS = 10 * 60 * 1000;

/**
 * Derive message / last_message / note timestamps from one base instant so
 * the inbox list relative time, bubble clock times, and note stamp stay
 * coherent after re-seed.
 *
 * @param {number} baseMs  Epoch ms for the *latest* event in this thread
 * @param {number} messageCount
 * @returns {{ messageAts: string[], lastMessageAt: string, noteAt: string }}
 */
export function buildThreadTimeline(baseMs, messageCount) {
  const count = Math.max(0, messageCount | 0);
  const messageAts = Array.from({ length: count }, (_, i) =>
    new Date(baseMs - (count - 1 - i) * SEED_STEP_MS).toISOString(),
  );
  const lastMessageAt =
    messageAts.length > 0
      ? messageAts[messageAts.length - 1]
      : new Date(baseMs).toISOString();
  // Note sits with the latest message so list + note share one clock.
  const noteAt = lastMessageAt;
  return { messageAts, lastMessageAt, noteAt };
}

export function buildSeedPlan({ accountId, userId, nowMs = Date.now() }) {
  if (!accountId || !userId) {
    throw new Error('accountId and userId are required');
  }
  // Newest contact thread ends at `nowMs - SEED_STEP_MS` so relative times
  // read as "N minutes ago" rather than "just now" in screenshots.
  const seedBaseMs = nowMs - SEED_STEP_MS;
  return {
    accountId,
    userId,
    seedBaseMs,
    agent: { ...DEMO_AGENT },
    tag: { ...DEMO_TAG, account_id: accountId, user_id: userId },
    noteText: DEMO_NOTE,
    contacts: DEMO_CONTACTS.map((c, index) => {
      // Stagger threads: Priya (0) is newest; older contacts sit further back.
      const threadBaseMs = seedBaseMs - index * SEED_STEP_MS;
      const messages = c.messages ?? [];
      const timeline = buildThreadTimeline(threadBaseMs, messages.length);
      return {
        phone: c.phone,
        name: c.name,
        email: c.email,
        company: c.company,
        account_id: accountId,
        user_id: userId,
        withConversation: c.withConversation,
        handoff: c.handoff ?? 'ai',
        lastMessage: c.lastMessage ?? null,
        messages,
        timeline,
      };
    }),
    broadcast: {
      ...DEMO_BROADCAST,
      account_id: accountId,
      user_id: userId,
    },
  };
}

function usage() {
  console.log(`Usage:
  SEED_ACCOUNT_ID=<uuid> SEED_USER_ID=<uuid> \\
  NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \\
  [SUPABASE_DB_SCHEMA=wacrm] [STORAGE_BUCKET_PREFIX=wacrm-] \\
  node deploy/staging/scripts/seed-demo-data.mjs [--dry-run]
`);
}

async function upsertTag(db, plan) {
  const { data: existing } = await db
    .from('tags')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('name', plan.tag.name)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await db
    .from('tags')
    .insert(plan.tag)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function upsertContact(db, plan, contact) {
  const row = {
    phone: contact.phone,
    name: contact.name,
    email: contact.email,
    company: contact.company,
    account_id: contact.account_id,
    user_id: contact.user_id,
  };
  const { data: existing } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('phone', contact.phone)
    .maybeSingle();
  if (existing?.id) {
    await db.from('contacts').update(row).eq('id', existing.id);
    return existing.id;
  }
  const { data, error } = await db.from('contacts').insert(row).select('id').single();
  if (error) throw error;
  return data.id;
}

async function ensureConversation(db, plan, contact) {
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('contact_id', contact.id)
    .maybeSingle();

  const lastMessageAt = contact.lastMessage
    ? (contact.timeline?.lastMessageAt ?? new Date(plan.seedBaseMs).toISOString())
    : null;

  const patch = {
    status: 'open',
    last_message_text: contact.lastMessage,
    last_message_at: lastMessageAt,
    assigned_agent_id: contact.handoff === 'human' ? plan.userId : null,
    ai_autoreply_disabled: contact.handoff === 'human',
    ai_handoff_summary:
      contact.handoff === 'human'
        ? 'Customer asked about billing — transferred to a human agent.'
        : null,
  };

  if (existing?.id) {
    await db.from('conversations').update(patch).eq('id', existing.id);
    return existing.id;
  }
  const { data, error } = await db
    .from('conversations')
    .insert({
      account_id: plan.accountId,
      user_id: plan.userId,
      contact_id: contact.id,
      ...patch,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureMessages(db, conversationId, messages, timeline) {
  if (!messages.length) return;
  const messageAts =
    timeline?.messageAts ??
    buildThreadTimeline(Date.now() - SEED_STEP_MS, messages.length).messageAts;

  const { data: existing } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (existing?.length) {
    // Re-seed timestamps so list relative time + bubble clocks stay aligned.
    const n = Math.min(existing.length, messageAts.length);
    for (let i = 0; i < n; i++) {
      const { error } = await db
        .from('messages')
        .update({ created_at: messageAts[i] })
        .eq('id', existing[i].id);
      if (error) throw error;
    }
    return;
  }

  const rows = messages.map((m, i) => ({
    conversation_id: conversationId,
    sender_type: m.sender,
    content_type: 'text',
    content_text: m.text,
    status: 'delivered',
    created_at: messageAts[i],
  }));
  const { error } = await db.from('messages').insert(rows);
  if (error) throw error;
}

async function ensureNote(db, plan, contactId, noteAt) {
  // Replace any prior internal seed notes on this contact.
  await db
    .from('contact_notes')
    .delete()
    .eq('account_id', plan.accountId)
    .eq('contact_id', contactId)
    .ilike('note_text', '%seed%');

  const stampedAt = noteAt ?? new Date(plan.seedBaseMs).toISOString();

  const { data: existing } = await db
    .from('contact_notes')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('contact_id', contactId)
    .eq('note_text', plan.noteText)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await db
      .from('contact_notes')
      .update({ created_at: stampedAt })
      .eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await db
    .from('contact_notes')
    .insert({
      account_id: plan.accountId,
      user_id: plan.userId,
      contact_id: contactId,
      note_text: plan.noteText,
      created_at: stampedAt,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function linkTag(db, contactId, tagId) {
  const { error } = await db.from('contact_tags').upsert(
    { contact_id: contactId, tag_id: tagId },
    { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
  );
  if (error) throw error;
}

async function ensureBroadcast(db, plan, contactIds) {
  const { data: existing } = await db
    .from('broadcasts')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('name', plan.broadcast.name)
    .maybeSingle();

  let broadcastId = existing?.id;
  if (!broadcastId) {
    const recipients = contactIds.slice(0, 5);
    // Insert with zero delivery counts — migration 005's incremental
    // trigger bumps sent/delivered/read from broadcast_recipients rows.
    // Hand-setting counts here used to double-count (Delivery 120%).
    const { data, error } = await db
      .from('broadcasts')
      .insert({
        account_id: plan.accountId,
        user_id: plan.userId,
        name: plan.broadcast.name,
        template_name: plan.broadcast.template_name,
        template_language: plan.broadcast.template_language,
        status: 'sent',
        total_recipients: recipients.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      })
      .select('id')
      .single();
    if (error) throw error;
    broadcastId = data.id;

    if (recipients.length) {
      const { error: rErr } = await db.from('broadcast_recipients').insert(
        recipients.map((contact_id, i) => ({
          broadcast_id: broadcastId,
          contact_id,
          status: i === 0 ? 'read' : i === 1 ? 'delivered' : 'sent',
          sent_at: new Date().toISOString(),
        })),
      );
      if (rErr) throw rErr;
    }
  } else {
    // Heal older seeds that double-counted before the zero-insert fix.
    const { error: rpcErr } = await db.rpc('recompute_broadcast_counts', {
      bid: broadcastId,
    });
    if (rpcErr) {
      console.warn(
        '[seed-demo-data] recompute_broadcast_counts failed:',
        rpcErr.message,
      );
    }
  }
  return broadcastId;
}

async function applyDemoAgentIdentity(db, plan) {
  // Prefer matching by user_id; fall back to id === userId.
  const { data: profile } = await db
    .from('profiles')
    .select('id, user_id')
    .eq('user_id', plan.userId)
    .maybeSingle();
  if (profile?.id) {
    const { error } = await db
      .from('profiles')
      .update({
        full_name: plan.agent.fullName,
        email: plan.agent.email,
      })
      .eq('id', profile.id);
    if (error) throw error;
  }

  await db
    .from('accounts')
    .update({ name: 'Demo Workspace' })
    .eq('id', plan.accountId);

  // Best-effort auth email rename (service role). Ignore failures so
  // CRM seeding still succeeds when Auth Admin is unavailable.
  try {
    await db.auth.admin.updateUserById(plan.userId, {
      email: plan.agent.email,
      email_confirm: true,
      user_metadata: { full_name: plan.agent.fullName },
    });
  } catch {
    // ignore
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return 0;
  }
  const dryRun = argv.includes('--dry-run');
  const accountId = process.env.SEED_ACCOUNT_ID?.trim();
  const userId = process.env.SEED_USER_ID?.trim();
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const dbSchema = resolveSeedDbSchema();
  const storageBucketPrefix = resolveSeedStorageBucketPrefix();

  const plan = buildSeedPlan({ accountId, userId });
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          db_schema: dbSchema,
          storage_bucket_prefix: storageBucketPrefix,
          storage_buckets: {
            avatars: resolveSeedStorageBucket('avatars'),
            'chat-media': resolveSeedStorageBucket('chat-media'),
            'flow-media': resolveSeedStorageBucket('flow-media'),
          },
          plan,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (!url || !key) {
    console.error(
      'FAIL: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
    usage();
    return 1;
  }

  const db = createClient(url, key, {
    db: { schema: dbSchema },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await applyDemoAgentIdentity(db, plan);

  const tagId = await upsertTag(db, plan);
  const contactIds = [];
  let conversationCount = 0;
  for (const c of plan.contacts) {
    const id = await upsertContact(db, plan, c);
    contactIds.push(id);
    await linkTag(db, id, tagId);
    await ensureNote(db, plan, id, c.timeline?.noteAt);
    if (c.withConversation) {
      const convId = await ensureConversation(db, plan, { ...c, id });
      await ensureMessages(db, convId, c.messages, c.timeline);
      conversationCount += 1;
    }
  }

  const broadcastId = await ensureBroadcast(db, plan, contactIds);

  console.log(
    JSON.stringify(
      {
        ok: true,
        account_id: plan.accountId,
        agent: plan.agent,
        tag_id: tagId,
        contact_ids: contactIds,
        conversations: conversationCount,
        broadcast_id: broadcastId,
        db_schema: dbSchema,
        storage_bucket_prefix: storageBucketPrefix,
      },
      null,
      2,
    ),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('FAIL:', err?.message || err);
      process.exit(1);
    });
}

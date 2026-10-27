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
 * Flags:
 *   --dry-run   print the payload and exit 0 (no network)
 *   --help
 *
 * Idempotent: contacts keyed by phone; tags by name; conversation by
 * contact. Safe to re-run. Branding is "Astra Chat" (not third-party demos).
 */
'use strict';

import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const DEMO_TAG = {
  name: 'Astra Chat Demo',
  color: '#145CF6',
};

export const DEMO_CONTACTS = Object.freeze([
  {
    phone: '+15550100001',
    name: 'Priya Sharma',
    email: 'priya.demo@astrachat.example',
    company: 'Astra Chat Demo Co',
  },
  {
    phone: '+15550100002',
    name: 'Jordan Lee',
    email: 'jordan.demo@astrachat.example',
    company: 'Astra Chat Demo Co',
  },
]);

export function buildSeedPlan({ accountId, userId }) {
  if (!accountId || !userId) {
    throw new Error('accountId and userId are required');
  }
  return {
    accountId,
    userId,
    tag: { ...DEMO_TAG, account_id: accountId, user_id: userId },
    contacts: DEMO_CONTACTS.map((c) => ({
      ...c,
      account_id: accountId,
      user_id: userId,
    })),
    noteText:
      'Seeded by deploy/staging/scripts/seed-demo-data.mjs for Astra Chat staging smoke.',
  };
}

function usage() {
  console.log(`Usage:
  SEED_ACCOUNT_ID=<uuid> SEED_USER_ID=<uuid> \\
  NEXT_PUBLIC_SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \\
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
  const { data: existing } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('phone', contact.phone)
    .maybeSingle();
  if (existing?.id) {
    await db
      .from('contacts')
      .update({
        name: contact.name,
        email: contact.email,
        company: contact.company,
      })
      .eq('id', existing.id);
    return existing.id;
  }
  const { data, error } = await db
    .from('contacts')
    .insert(contact)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureConversation(db, plan, contactId) {
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('contact_id', contactId)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await db
    .from('conversations')
    .insert({
      account_id: plan.accountId,
      user_id: plan.userId,
      contact_id: contactId,
      status: 'open',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function ensureNote(db, plan, contactId) {
  const { data: existing } = await db
    .from('contact_notes')
    .select('id')
    .eq('account_id', plan.accountId)
    .eq('contact_id', contactId)
    .eq('note_text', plan.noteText)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await db
    .from('contact_notes')
    .insert({
      account_id: plan.accountId,
      user_id: plan.userId,
      contact_id: contactId,
      note_text: plan.noteText,
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

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return 0;
  }
  const dryRun = argv.includes('--dry-run');
  const accountId = process.env.SEED_ACCOUNT_ID?.trim();
  const userId = process.env.SEED_USER_ID?.trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const plan = buildSeedPlan({ accountId, userId });
  if (dryRun) {
    console.log(JSON.stringify({ dry_run: true, plan }, null, 2));
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
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tagId = await upsertTag(db, plan);
  const contactIds = [];
  for (const c of plan.contacts) {
    const id = await upsertContact(db, plan, c);
    contactIds.push(id);
    await linkTag(db, id, tagId);
    await ensureConversation(db, plan, id);
    await ensureNote(db, plan, id);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        account_id: plan.accountId,
        tag_id: tagId,
        contact_ids: contactIds,
        brand: 'Astra Chat',
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

#!/usr/bin/env node
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedPlan,
  buildThreadTimeline,
  DEMO_AGENT,
  DEMO_CONTACTS,
  DEMO_NOTE,
  DEMO_TAG,
  SEED_STEP_MS,
} from './seed-demo-data.mjs';

test('buildSeedPlan uses Demo Agent identity and realistic copy', () => {
  const plan = buildSeedPlan({
    accountId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(plan.agent.fullName, DEMO_AGENT.fullName);
  assert.equal(plan.agent.email, DEMO_AGENT.email);
  assert.equal(plan.tag.name, DEMO_TAG.name);
  assert.equal(plan.noteText, DEMO_NOTE);
  assert.equal(plan.contacts.length, 8);
  assert.equal(plan.contacts.filter((c) => c.withConversation).length, 5);
  assert.ok(plan.contacts.some((c) => c.handoff === 'human'));
  assert.equal(plan.broadcast.status, 'sent');

  const blob = JSON.stringify(plan);
  assert.doesNotMatch(blob, /CHAT-?\d+/i);
  assert.doesNotMatch(blob, /seed-demo-data/);
  assert.doesNotMatch(blob, /staging smoke/i);
  assert.doesNotMatch(blob, /Chat14/i);
});

test('buildSeedPlan refuses missing ids', () => {
  assert.throws(() => buildSeedPlan({ accountId: '', userId: 'x' }), /required/);
});

test('DEMO_CONTACTS stay customer-facing', () => {
  for (const c of DEMO_CONTACTS) {
    assert.ok(c.name);
    assert.match(c.phone, /^\+1555010000\d$/);
    assert.doesNotMatch(c.email, /chat14/i);
    assert.doesNotMatch(c.company, /CHAT-?\d+/i);
  }
});

test('buildThreadTimeline shares one base across messages, last, and note', () => {
  const base = Date.parse('2026-10-27T19:35:00.000Z');
  const tl = buildThreadTimeline(base, 3);
  assert.equal(tl.messageAts.length, 3);
  assert.equal(tl.messageAts[2], new Date(base).toISOString());
  assert.equal(tl.messageAts[1], new Date(base - SEED_STEP_MS).toISOString());
  assert.equal(tl.messageAts[0], new Date(base - 2 * SEED_STEP_MS).toISOString());
  assert.equal(tl.lastMessageAt, tl.messageAts[2]);
  assert.equal(tl.noteAt, tl.lastMessageAt);
});

test('buildSeedPlan timelines keep list + bubbles + note on one clock', () => {
  const nowMs = Date.parse('2026-10-27T20:00:00.000Z');
  const plan = buildSeedPlan({
    accountId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    nowMs,
  });
  const priya = plan.contacts[0];
  assert.ok(priya.timeline);
  assert.equal(priya.timeline.lastMessageAt, priya.timeline.noteAt);
  assert.equal(
    priya.timeline.lastMessageAt,
    priya.timeline.messageAts[priya.timeline.messageAts.length - 1],
  );
  // Stagger: contact 1 ends one step earlier than contact 0.
  assert.equal(
    Date.parse(plan.contacts[1].timeline.lastMessageAt),
    Date.parse(priya.timeline.lastMessageAt) - SEED_STEP_MS,
  );
});

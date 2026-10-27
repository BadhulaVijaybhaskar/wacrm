/**
 * Unit tests for the staging Connect stub (node:test).
 * Kept under deploy/staging so vitest's default include (src/**) ignores it;
 * run with: node --test deploy/staging/connect-stub/server.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

const SECRET = 'staging-smoke-secret-ok';
const ROOT = __dirname;

function sign(ts, body) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', SECRET).update(String(ts) + '.').update(body).digest('hex')
  );
}

function post(port, p, body, headers = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  return new Promise((ok, bad) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: p,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': raw.length,
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text || '{}');
          } catch (_) {}
          ok({ status: res.statusCode, json, headers: res.headers });
        });
      }
    );
    req.on('error', bad);
    req.end(raw);
  });
}

test('connect-stub: inbound, replay, message, handoff, auth', async (t) => {
  const port = 21000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      WACRM_ADAPTER_SECRET: SECRET,
      RATE_LIMIT_EVERY: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill();
  });

  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      up = r.ok;
    } catch (_) {}
    if (!up) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(up, 'stub did not start');

  const inbound = {
    tenant_id: 't1',
    phone_number_id: '106540352242922',
    customer_phone: '+919812345678',
    message_id: 'wamid.stub1',
    timestamp: new Date().toISOString(),
    text: 'hello stub',
  };
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify(inbound);
  const r1 = await post(port, '/api/channels/whatsapp/inbound', inbound, {
    'X-Astra-Timestamp': ts,
    'X-Astra-Signature': sign(ts, raw),
  });
  assert.equal(r1.status, 200);
  assert.ok(r1.json.reply_text);
  assert.match(r1.json.conversation_id, /^conv_stub_/);

  const r2 = await post(port, '/api/channels/whatsapp/inbound', inbound, {
    'X-Astra-Timestamp': ts,
    'X-Astra-Signature': sign(ts, raw),
  });
  assert.equal(r2.json.duplicate, true);

  const bad = await post(port, '/api/channels/whatsapp/inbound', inbound, {
    'X-Astra-Timestamp': ts,
    'X-Astra-Signature': 'sha256=' + 'ab'.repeat(32),
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.code, 'bad_signature');

  const msg = {
    tenant_id: 't1',
    phone_number_id: '106540352242922',
    customer_phone: '+919812345678',
    message_id: 'wamid.out1',
    timestamp: new Date().toISOString(),
    author: 'human',
    text: 'team reply',
  };
  const mraw = JSON.stringify(msg);
  const rm = await post(port, '/api/channels/whatsapp/message', msg, {
    'X-Astra-Timestamp': ts,
    'X-Astra-Signature': sign(ts, mraw),
  });
  assert.equal(rm.status, 200);
  assert.equal(rm.json.stored, true);

  const ho = {
    tenant_id: 't1',
    conversation_id: r1.json.conversation_id,
    handoff: false,
  };
  const hraw = JSON.stringify(ho);
  const rh = await post(port, '/api/channels/whatsapp/handoff', ho, {
    'X-Astra-Timestamp': ts,
    'X-Astra-Signature': sign(ts, hraw),
  });
  assert.equal(rh.status, 200);
  assert.equal(rh.json.handoff, false);
});

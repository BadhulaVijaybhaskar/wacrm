#!/usr/bin/env node
/**
 * Staging Connect adapter stub.
 *
 * Serves the three wacrm→Connect endpoints with HMAC verification and
 * canned replies so staging never calls live Astra Connect. Behaviour
 * mirrors the cross-test harness (contract v2), without vendoring
 * Connect's source.
 *
 *   POST /api/channels/whatsapp/inbound
 *   POST /api/channels/whatsapp/message
 *   POST /api/channels/whatsapp/handoff
 *   GET  /health
 *
 * Env:
 *   WACRM_ADAPTER_SECRET  (≥16 chars, required)
 *   PORT                  (default 8090)
 *   HOST                  (default 0.0.0.0)
 *   RATE_LIMIT_EVERY      (optional; every N-th unique inbound message_id
 *                         gets 429 once, then succeeds — for smoke tests)
 */
'use strict';

const http = require('http');
const crypto = require('crypto');

const SECRET = process.env.WACRM_ADAPTER_SECRET || '';
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_SKEW_SEC = 300;
const MAX_BODY = 256 * 1024;
const RATE_LIMIT_EVERY = Number(process.env.RATE_LIMIT_EVERY || 0);

/** @type {Map<string, object>} */
const inboundDone = new Map();
/** @type {Map<string, object>} */
const messageDone = new Map();
/** @type {Map<string, boolean>} */
const handoffByConv = new Map();
/** @type {Set<string>} */
const rateLimitedOnce = new Set();
let inboundCount = 0;

function fail(status, code, error, extra) {
  return { status, body: { error, code, ...(extra || {}) } };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sign(secret, timestamp, rawBody) {
  return (
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(String(timestamp) + '.')
      .update(rawBody)
      .digest('hex')
  );
}

function verifyAuth(headers, rawBody) {
  if (!SECRET || SECRET.length < 16) {
    return fail(503, 'not_configured', 'WACRM_ADAPTER_SECRET is not configured');
  }
  const sig = headers['x-astra-signature'];
  if (!sig) {
    return fail(
      401,
      'signature_required',
      'X-Astra-Timestamp and X-Astra-Signature are required'
    );
  }
  const tsRaw = String(headers['x-astra-timestamp'] || '');
  const ts = /^\d{9,11}$/.test(tsRaw) ? Number(tsRaw) : NaN;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > MAX_SKEW_SEC) {
    return fail(
      401,
      'stale_signature',
      'X-Astra-Timestamp missing or more than 300 s from server time'
    );
  }
  if (!safeEqual(sig, sign(SECRET, tsRaw, rawBody))) {
    return fail(401, 'bad_signature', 'signature does not match');
  }
  return null;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let len = 0;
    const chunks = [];
    req.on('data', (c) => {
      len += c.length;
      if (len > MAX_BODY) {
        reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body, headers) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(raw),
    ...(headers || {}),
  });
  res.end(raw);
}

function processInbound(body) {
  const messageId = typeof body.message_id === 'string' ? body.message_id.trim() : '';
  if (!messageId) return fail(400, 'missing_message_id', 'message_id is required');
  if (!body.tenant_id) return fail(400, 'missing_tenant', 'tenant_id is required');
  if (!body.phone_number_id && !body.employee_id && !body.whatsapp_number) {
    return fail(400, 'missing_employee', 'phone_number_id is required');
  }
  if (!body.customer_phone) {
    return fail(422, 'bad_customer_phone', 'customer_phone must be E.164');
  }

  const prior = inboundDone.get(messageId);
  if (prior) {
    return { status: 200, body: { ...prior, duplicate: true } };
  }

  inboundCount += 1;
  if (
    RATE_LIMIT_EVERY > 0 &&
    inboundCount % RATE_LIMIT_EVERY === 0 &&
    !rateLimitedOnce.has(messageId)
  ) {
    rateLimitedOnce.add(messageId);
    return {
      status: 429,
      body: {
        error: 'too many WhatsApp messages for this tenant; retry after a minute',
        code: 'rate_limited',
        retry_after_sec: 60,
      },
      headers: { 'Retry-After': '60' },
    };
  }

  const text = typeof body.text === 'string' ? body.text : '';
  const wantsHandoff = /handoff|human|agent/i.test(text);
  const convId = 'conv_stub_' + crypto.createHash('sha1').update(messageId).digest('hex').slice(0, 12);
  if (handoffByConv.get(convId)) {
    const response = {
      reply_text: null,
      handoff: true,
      conversation_id: convId,
    };
    inboundDone.set(messageId, response);
    return { status: 200, body: response };
  }

  const response = {
    reply_text: wantsHandoff
      ? 'Connecting you with a teammate. [[HANDOFF]]'.replace(' [[HANDOFF]]', '')
      : 'Hi! (staging stub) Thanks for your message about: ' +
        (text.slice(0, 80) || '[media]'),
    handoff: wantsHandoff,
    conversation_id: convId,
  };
  if (wantsHandoff) handoffByConv.set(convId, true);
  inboundDone.set(messageId, response);
  return { status: 200, body: response };
}

function processMessage(body) {
  const messageId = typeof body.message_id === 'string' ? body.message_id.trim() : '';
  if (!messageId) return fail(400, 'missing_message_id', 'message_id is required');
  if (!body.tenant_id) return fail(400, 'missing_tenant', 'tenant_id is required');
  if (body.author !== 'human' && body.author !== 'template') {
    return fail(400, 'bad_author', 'author must be "human" or "template"');
  }
  const prior = messageDone.get(messageId);
  if (prior) return { status: 200, body: { ...prior, duplicate: true } };
  const convId =
    'conv_stub_' +
    crypto
      .createHash('sha1')
      .update(String(body.customer_phone || messageId))
      .digest('hex')
      .slice(0, 12);
  const response = {
    conversation_id: convId,
    stored: true,
    handoff: !!handoffByConv.get(convId),
  };
  messageDone.set(messageId, response);
  return { status: 200, body: response };
}

function processHandoff(body) {
  if (!body || typeof body.handoff !== 'boolean') {
    return fail(400, 'bad_handoff', 'handoff must be true or false');
  }
  if (!body.tenant_id) return fail(400, 'missing_tenant', 'tenant_id is required');
  let convId =
    typeof body.conversation_id === 'string' ? body.conversation_id.trim() : '';
  if (!convId) {
    convId =
      'conv_stub_' +
      crypto
        .createHash('sha1')
        .update(String(body.customer_phone || 'unknown'))
        .digest('hex')
        .slice(0, 12);
  }
  handoffByConv.set(convId, body.handoff);
  return { status: 200, body: { conversation_id: convId, handoff: body.handoff } };
}

const ROUTES = {
  '/api/channels/whatsapp/inbound': processInbound,
  '/api/channels/whatsapp/message': processMessage,
  '/api/channels/whatsapp/handoff': processHandoff,
};

const server = http.createServer(async (req, res) => {
  const route = (req.url || '').split('?')[0];
  if (req.method === 'GET' && route === '/health') {
    return sendJson(res, 200, { ok: true, service: 'connect-stub' });
  }
  if (!Object.prototype.hasOwnProperty.call(ROUTES, route)) {
    return sendJson(res, 404, { error: 'not found', code: 'not_found' });
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, {
      error: 'method not allowed',
      code: 'method_not_allowed',
    });
  }

  let raw;
  try {
    raw = await readRaw(req);
  } catch (e) {
    return sendJson(res, 413, { error: 'payload too large', code: 'too_large' });
  }

  const denied = verifyAuth(req.headers || {}, raw);
  if (denied) return sendJson(res, denied.status, denied.body, denied.headers);

  let body;
  try {
    body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch (_) {
    return sendJson(res, 400, { error: 'invalid json', code: 'bad_json' });
  }

  try {
    const out = ROUTES[route](body);
    return sendJson(res, out.status, out.body, out.headers);
  } catch (e) {
    console.error('[connect-stub]', e);
    return sendJson(res, 500, { error: 'internal error', code: 'internal' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    `[connect-stub] listening on http://${HOST}:${PORT} (secret ${
      SECRET.length >= 16 ? 'configured' : 'MISSING'
    })`
  );
});

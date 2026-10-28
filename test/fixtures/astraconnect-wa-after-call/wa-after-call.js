'use strict'
/**
 * Minimal Astraconnect console after-call client (PR #33 / 97b9948 API surface
 * used by Voice's contract-e2e harness). Not a full Connect port — only
 * listTemplates + createAfterCall({enqueue,sendOne}) against WACRM_API_URL.
 */
const { sign } = require('./wa-provider')

function envOf(opts) {
  return opts.env || process.env
}

function baseUrl(env) {
  return String(env.WACRM_API_URL || '').replace(/\/+$/, '')
}

async function listTemplates(args, opts = {}) {
  const env = envOf(opts)
  const fetchImpl = opts.fetchImpl || fetch
  const tenantId = args.tenantId
  const phoneNumberId = args.phoneNumberId
  const wabaId = args.wabaId
  const qs = new URLSearchParams({
    tenant_id: tenantId,
    phone_number_id: phoneNumberId,
    status: 'APPROVED',
  })
  if (wabaId) qs.set('waba_id', wabaId)
  const path = `/api/astra-connect/v1/whatsapp/templates?${qs.toString()}`
  const ts = String(Math.floor(Date.now() / 1000))
  const secret = env.WACRM_ADAPTER_SECRET
  const headers = {
    'x-astra-timestamp': ts,
    'x-astra-tenant': tenantId,
    'x-astra-signature': sign(secret, ts, path, tenantId),
  }
  const res = await fetchImpl(baseUrl(env) + path, { method: 'GET', headers })
  if (!res.ok) {
    return { source: 'fallback', items: [{ name: 'hello_world', language: 'en_US' }] }
  }
  const json = await res.json()
  const items = Array.isArray(json.templates) ? json.templates : []
  if (!items.length) {
    return { source: 'fallback', items: [{ name: 'hello_world', language: 'en_US' }] }
  }
  return { source: 'waba', items }
}

function createAfterCall(opts) {
  const env = envOf(opts)
  const fetchImpl = opts.fetchImpl || fetch
  const store = opts.store
  const log = opts.log || (() => {})

  function db() {
    return store.db()
  }

  async function enqueue(args) {
    const d = db()
    if (!d.waAfterCallSends) d.waAfterCallSends = []
    const emp = (d.employees || []).find(
      (e) => e.id === args.employeeId && e.tenantId === args.tenantId,
    )
    const cfg = emp && emp.whatsappAfterCall
    if (!cfg || !cfg.enabled) return null
    if (args.answered === false && cfg.trigger && cfg.trigger.mode === 'answered') {
      return null
    }
    const call = (d.calls || []).find((c) => c.id === args.callId)
    const id = 'wac_' + String(args.callId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)
    const rec = {
      id,
      tenantId: args.tenantId,
      employeeId: args.employeeId,
      callId: args.callId,
      state: 'pending',
      reason: null,
      error: null,
      attempts: 0,
      to: (call && (call.contactPhone || call.fromE164)) || null,
      template: cfg.template || { name: 'hello_world', language: 'en_US' },
      variables: Array.isArray(cfg.variables) ? cfg.variables : [],
      freeText: cfg.freeText || '',
      phoneNumberId:
        (emp.channels && emp.channels.whatsappPhoneNumberId) || null,
      wabaId: null,
    }
    const wan = (d.whatsappNumbers || []).find(
      (n) => n.phoneNumberId === rec.phoneNumberId && n.tenantId === args.tenantId,
    )
    if (wan) rec.wabaId = wan.wabaId
    d.waAfterCallSends.push(rec)
    return rec
  }

  async function sendOne(sendId) {
    const d = db()
    const rec = (d.waAfterCallSends || []).find((r) => r.id === sendId)
    if (!rec) return null
    rec.attempts = (rec.attempts || 0) + 1

    const useText = Boolean(rec.freeText && String(rec.freeText).trim())
    const bodyObj = useText
      ? {
          kind: 'whatsapp.after_call',
          send_id: rec.id,
          tenant_id: rec.tenantId,
          employee_id: rec.employeeId,
          call_id: rec.callId,
          phone_number_id: rec.phoneNumberId,
          waba_id: rec.wabaId,
          to: rec.to,
          type: 'text',
          text: rec.freeText,
        }
      : {
          kind: 'whatsapp.after_call',
          send_id: rec.id,
          tenant_id: rec.tenantId,
          employee_id: rec.employeeId,
          call_id: rec.callId,
          phone_number_id: rec.phoneNumberId,
          waba_id: rec.wabaId,
          to: rec.to,
          type: 'template',
          template: {
            name: (rec.template && rec.template.name) || 'hello_world',
            language: (rec.template && rec.template.language) || 'en_US',
            variables: rec.variables || [],
          },
        }

    const raw = JSON.stringify(bodyObj)
    const ts = String(Math.floor(Date.now() / 1000))
    const secret = env.WACRM_ADAPTER_SECRET
    const idem = useText
      ? `after-call:${rec.callId}`
      : `after-call:${rec.callId}`
    const headers = {
      'content-type': 'application/json',
      'x-astra-timestamp': ts,
      'x-astra-tenant': rec.tenantId,
      'x-astra-signature': sign(secret, ts, raw, rec.tenantId),
      'idempotency-key': idem,
    }
    const url = baseUrl(env) + '/api/astra-connect/v1/whatsapp/send'
    let res
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: raw })
    } catch (err) {
      rec.state = 'failed'
      rec.error = 'unreachable'
      log('[wa-after-call]', rec.id, 'unreachable', err && err.message)
      return rec
    }
    const json = await res.json().catch(() => ({}))
    if (res.status === 200 && json && json.ok) {
      rec.state = 'sent'
      rec.messageId = json.message_id || null
      rec.dryRun = Boolean(json.dry_run)
      return rec
    }
    if (res.status === 409 && json && json.error === 'window_closed') {
      // Spec: Connect retries once as template. Mirror that here.
      const tpl = rec.template || { name: 'hello_world', language: 'en_US' }
      const retryBody = JSON.stringify({
        kind: 'whatsapp.after_call',
        send_id: rec.id,
        tenant_id: rec.tenantId,
        employee_id: rec.employeeId,
        call_id: rec.callId,
        phone_number_id: rec.phoneNumberId,
        waba_id: rec.wabaId,
        to: rec.to,
        type: 'template',
        template: {
          name: tpl.name,
          language: tpl.language || 'en_US',
          variables: rec.variables || [],
        },
      })
      const ts2 = String(Math.floor(Date.now() / 1000))
      const headers2 = {
        'content-type': 'application/json',
        'x-astra-timestamp': ts2,
        'x-astra-tenant': rec.tenantId,
        'x-astra-signature': sign(secret, ts2, retryBody, rec.tenantId),
        'idempotency-key': `after-call:${rec.callId}:template`,
      }
      const res2 = await fetchImpl(url, {
        method: 'POST',
        headers: headers2,
        body: retryBody,
      })
      const json2 = await res2.json().catch(() => ({}))
      if (res2.status === 200 && json2 && json2.ok) {
        rec.state = 'sent'
        rec.messageId = json2.message_id || null
        rec.reason = 'window_closed_template_retry'
        return rec
      }
      rec.state = 'failed'
      rec.error = (json2 && json2.error) || 'window_closed'
      return rec
    }
    rec.state = 'failed'
    rec.error = (json && json.error) || `http_${res.status}`
    if (res.status === 401 || res.status === 403) rec.reason = 'auth_failed'
    if (res.status === 404) rec.reason = 'endpoint_missing'
    return rec
  }

  return { enqueue, sendOne }
}

module.exports = { listTemplates, createAfterCall }

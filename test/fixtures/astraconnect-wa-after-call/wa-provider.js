'use strict'
/**
 * Minimal Astraconnect wa-provider signing helper (PR #33 / 97b9948 shape).
 * Matches Chat authenticateConnectRequest: HMAC over
 *   `${timestamp}.${rawBody}.${tenant}` for POST bodies, and
 *   `${timestamp}.${pathAndQuery}.${tenant}` for GET.
 *
 * Pure §2 signs `${timestamp}.${rawBody}` without tenant; §16 adds
 * X-Astra-Tenant and Connect's client includes it in the signed string.
 */
const crypto = require('node:crypto')

function sign(secret, timestamp, rawBodyOrCanonical, tenant) {
  const ts = String(timestamp)
  const body = typeof rawBodyOrCanonical === 'string'
    ? rawBodyOrCanonical
    : Buffer.isBuffer(rawBodyOrCanonical)
      ? rawBodyOrCanonical.toString('utf8')
      : String(rawBodyOrCanonical ?? '')
  const payload = tenant ? `${body}.${tenant}` : body
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(ts + '.').update(payload).digest('hex')
  )
}

module.exports = { sign }

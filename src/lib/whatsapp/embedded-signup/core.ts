import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/admin';
import { decryptToken, encryptToken } from './crypto';
import { sanitizeLastError } from './errors';

export const enabled = () => process.env.WACRM_EMBEDDED_SIGNUP === '1';
export const signupInput = z.object({
  code: z.string().min(1).max(4096),
  waba_id: z.string().regex(/^\d{1,32}$/),
  phone_number_id: z.string().regex(/^\d{1,32}$/),
  business_id: z.string().regex(/^\d{1,32}$/).optional(),
}).strict();
export type SignupInput = z.infer<typeof signupInput>;

export class SignupError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly metaCode?: number) { super(code); }
}
export const publicError = (e: unknown) => e instanceof SignupError && e.code === 'pin_mismatch'
  ? { status: 409, body: { error: 'pin_mismatch', code: 'pin_mismatch', message: 'Turn off two-step verification for this number in WhatsApp Manager, then retry connecting.' } }
  : e instanceof SignupError
  ? { status: e.status, body: { error: e.code, message: 'WhatsApp connection could not be completed.' } }
  : { status: 500, body: { error: 'internal_error', message: 'WhatsApp connection could not be completed.' } };

function graphVersion() {
  const version = process.env.META_GRAPH_VERSION || 'v23.0';
  if (!/^v\d+\.\d+$/.test(version)) throw new SignupError('configuration_error', 503);
  return version;
}
async function graph(path: string, token?: string, method = 'GET', data?: object) {
  const version = graphVersion();
  let response: Response;
  try { response = await fetch('https://graph.facebook.com/' + version + '/' + path, {
    method, redirect: 'error',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
    cache: 'no-store',
  });
  } catch { throw new SignupError('meta_request_failed', 502); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaCode = typeof body?.error?.code === 'number' ? body.error.code : undefined;
    throw new SignupError('meta_request_failed', 502, metaCode);
  }
  if (!body || (method !== 'GET' && body.success !== true)) throw new SignupError('meta_request_failed', 502);
  return body;
}
export async function connect(input: SignupInput, accountId: string) {
  const appId = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET?.split(',')[0]?.trim();
  if (!appId || !secret) throw new SignupError('configuration_error', 503);
  const params = new URLSearchParams({ client_id: appId, client_secret: secret, code: input.code });
  const exchange = await graph('oauth/access_token?' + params.toString());
  if (typeof exchange.access_token !== 'string' || !exchange.access_token) throw new SignupError('exchange_failed', 502);
  const token: string = exchange.access_token;
  const assets = await graph(input.waba_id + '/phone_numbers?fields=id', token);
  if (!Array.isArray(assets.data) || !assets.data.some((p: {id?: string}) => p.id === input.phone_number_id))
    throw new SignupError('asset_mismatch', 403);
  const phone = await graph(input.phone_number_id + '?fields=display_phone_number,verified_name,quality_rating', token);
  const service = createServiceClient().schema('wacrm');
  // Existing legacy ownership is still authoritative during the mixed rollout.
  const { data: legacyOwners, error: legacyError } = await service.from('whatsapp_config')
    .select('account_id').eq('phone_number_id', input.phone_number_id).neq('account_id', accountId).limit(1);
  if (legacyError || !legacyOwners) throw new SignupError('database_error', 500);
  if (legacyOwners.length > 0) throw new SignupError('number_in_use_legacy', 409);
  // This fast rejection is backed by the atomic claim below (the race arbiter).
  const { data: owner, error: ownershipError } = await service.from('wa_connections')
    .select('account_id,status,updated_at').eq('phone_number_id', input.phone_number_id).maybeSingle();
  if (ownershipError) throw new SignupError('database_error', 500);
  const recoverable = owner && (owner.status === 'disconnected' || owner.status === 'error'
    || (owner.status === 'pending' && Date.parse(owner.updated_at) < Date.now() - 15 * 60 * 1000));
  if (owner && owner.account_id !== accountId && !recoverable)
    throw new SignupError('phone_in_use', 409);
  // Read a saved PIN only through an account-scoped lookup. A takeover must
  // neither load/decrypt another account's ciphertext nor register with its PIN.
  let savedPin: string | null = null;
  if (owner?.account_id === accountId) {
    const { data: own, error: pinError } = await service.from('wa_connections')
      .select('pin_ciphertext').eq('phone_number_id', input.phone_number_id)
      .eq('account_id', accountId).maybeSingle();
    if (pinError) throw new SignupError('database_error', 500);
    savedPin = own?.pin_ciphertext || null;
  }
  const pin = savedPin ? decryptToken(savedPin) : String(randomInt(0, 1000000)).padStart(6, '0');
  const { data, error } = await service.rpc('claim_wa_connection', {
    p_account_id: accountId, p_waba_id: input.waba_id, p_phone_number_id: input.phone_number_id,
    p_business_id: input.business_id || null,
    p_display_phone_number: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : null,
    p_verified_name: typeof phone.verified_name === 'string' ? phone.verified_name : null,
    p_quality_rating: typeof phone.quality_rating === 'string' ? phone.quality_rating : null,
    p_token_ciphertext: encryptToken(token), p_pin_ciphertext: encryptToken(pin),
  });
  if (error) {
    if (error.code === '23505' || error.message?.includes('wa_connection_owned')) throw new SignupError('phone_in_use', 409);
    throw new SignupError('database_error', 500);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) throw new SignupError('database_error', 500);
  const wasConnected = result.status === 'connected';
  // This is the POST-upsert stored token, not necessarily the former token.
  // Only connected claims preserve the former value; use it solely to restore
  // that same account's live connection on failure. It is never a token to revoke.
  if (wasConnected && typeof result.stored_token_ciphertext !== 'string')
    throw new SignupError('database_error', 500);
  // Use the atomically claimed PIN rather than a potentially stale pre-check.
  const registrationPin = result.claimed_pin_ciphertext ? decryptToken(result.claimed_pin_ciphertext) : pin;
  const update = async (status: string, last_error: string | null, fields: Record<string, unknown> = {}) => {
    const { data: updated, error: updateError } = await service.from('wa_connections')
      .update({ ...fields, status, last_error, updated_at: new Date().toISOString() })
      .eq('account_id', accountId).eq('id', result.id)
      .eq('status', wasConnected ? 'connected' : 'pending').select('id');
    if (updateError) throw new SignupError('database_error', 500);
    if (!updated || updated.length === 0) throw new SignupError('state_changed', 409);
  };
  try {
    try {
      await graph(input.phone_number_id + '/register', token, 'POST', { messaging_product: 'whatsapp', pin: registrationPin });
    } catch (error) {
      // Meta Cloud API error reference: 133005 = two-step verification PIN incorrect.
      // https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
      if (error instanceof SignupError && error.metaCode === 133005)
        throw new SignupError('pin_mismatch', 409, 133005);
      throw error;
    }
    await graph(input.waba_id + '/subscribed_apps', token, 'POST');
    await update('connected', null, {
      token_ciphertext: encryptToken(token), waba_id: input.waba_id,
      business_id: input.business_id || null,
      display_phone_number: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : null,
      verified_name: typeof phone.verified_name === 'string' ? phone.verified_name : null,
      quality_rating: typeof phone.quality_rating === 'string' ? phone.quality_rating : null,
    });
  } catch (error) {
    // A concurrent disconnect/transfer wins. Do not restore over its state.
    if (error instanceof SignupError && error.code === 'state_changed') throw error;
    try {
      await update(wasConnected ? 'connected' : 'error', sanitizeLastError(error instanceof SignupError ? error.code : undefined, error instanceof SignupError ? error.metaCode : undefined),
        wasConnected ? { token_ciphertext: result.stored_token_ciphertext } : {});
    } catch (restoreError) {
      if (restoreError instanceof SignupError && restoreError.code === 'state_changed') throw restoreError;
      // Preserve the original Meta error if recording/restoring state fails.
    }
    throw error instanceof SignupError ? error : new SignupError('meta_request_failed', 502);
  }
  // Explicit allowlist: even an unexpected RPC response cannot leak ciphertext.
  return {
    id: result.id, display_phone_number: typeof phone.display_phone_number === 'string' ? phone.display_phone_number : null,
    verified_name: typeof phone.verified_name === 'string' ? phone.verified_name : null,
    quality_rating: typeof phone.quality_rating === 'string' ? phone.quality_rating : null,
    waba_id: input.waba_id, status: 'connected',
  };
}
export async function unsubscribe(waba: string, token: string) {
  await graph(waba + '/subscribed_apps', token, 'DELETE');
}

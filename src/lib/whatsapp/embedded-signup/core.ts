import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/admin';
import { encryptToken } from './crypto';

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
export const publicError = (e: unknown) => e instanceof SignupError
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
  const pin = String(randomInt(0, 1000000)).padStart(6, '0');
  const service = createServiceClient().schema('wacrm');
  // This fast rejection is backed by the atomic claim below (the race arbiter).
  const { data: owner, error: ownershipError } = await service.from('wa_connections')
    .select('account_id').eq('phone_number_id', input.phone_number_id).maybeSingle();
  if (ownershipError) throw new SignupError('database_error', 500);
  if (owner && owner.account_id !== accountId) throw new SignupError('phone_in_use', 409);
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
  const update = async (status: string, last_error: string | null) => {
    const { error: updateError } = await service.from('wa_connections')
      .update({ status, last_error, updated_at: new Date().toISOString() })
      .eq('account_id', accountId).eq('id', result.id);
    if (updateError) throw new SignupError('database_error', 500);
  };
  try {
    await graph(input.phone_number_id + '/register', token, 'POST', { messaging_product: 'whatsapp', pin });
    await graph(input.waba_id + '/subscribed_apps', token, 'POST');
    await update('connected', null);
  } catch (error) {
    await update('error', error instanceof SignupError ? error.code : 'meta_request_failed');
    throw error instanceof SignupError ? error : new SignupError('meta_request_failed', 502);
  }
  // Explicit allowlist: even an unexpected RPC response cannot leak ciphertext.
  return {
    id: result.id, display_phone_number: result.display_phone_number,
    verified_name: result.verified_name, quality_rating: result.quality_rating,
    waba_id: result.waba_id, status: 'connected',
  };
}
export async function unsubscribe(waba: string, token: string) {
  await graph(waba + '/subscribed_apps', token, 'DELETE');
}

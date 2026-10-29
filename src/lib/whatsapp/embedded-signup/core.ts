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
  const response = await fetch('https://graph.facebook.com/' + graphVersion() + '/' + path, {
    method, redirect: 'error',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const metaCode = typeof body?.error?.code === 'number' ? body.error.code : undefined;
    if (metaCode !== undefined) console.warn('[embedded-signup] Meta error code', metaCode);
    if (response.status === 404) throw new SignupError('meta_not_found', 404, metaCode);
    throw new SignupError('meta_request_failed', 502, metaCode);
  }
  return body;
}
export function alreadyRegistered(error: unknown): boolean {
  return error instanceof SignupError && error.metaCode === 100 && error.code === 'meta_request_failed';
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
  try {
    await graph(input.phone_number_id + '/register', token, 'POST', { messaging_product: 'whatsapp', pin });
  } catch (error) {
    // Meta 100 covers many unrelated errors; require explicit already-registered subcode
    // before tolerating it. Never convert arbitrary registration failures to success.
    if (!(error instanceof SignupError && error.metaCode === 136024)) throw error;
  }
  await graph(input.waba_id + '/subscribed_apps', token, 'POST');
  const service = createServiceClient().schema('wacrm');
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
  return result as {id:string;display_phone_number:string|null;verified_name:string|null;quality_rating:string|null;waba_id:string;status:string};
}
export async function unsubscribe(waba: string, token: string) {
  try { await graph(waba + '/subscribed_apps', token, 'DELETE'); }
  catch (error) { if (!(error instanceof SignupError && error.status === 404)) throw error; }
}

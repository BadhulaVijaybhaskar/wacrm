import { createServiceClient } from '@/lib/supabase/admin';
import { decryptToken } from './crypto';

/** Every config field read by processWebhook; token is already decrypted. */
export type WebhookConnection = {
  account_id: string;
  user_id: string;
  mirror_inbound_media?: boolean;
  accessToken: string;
};

export type WebhookResolution =
  | { status: 'connected'; connection: WebhookConnection }
  | { status: 'not_found' | 'not_connected' };

export async function resolveEmbeddedWebhookConnection(phoneNumberId: string): Promise<WebhookResolution> {
  if (!phoneNumberId) return { status: 'not_connected' };
  const db = createServiceClient().schema('wacrm');
  const { data: rows, error } = await db.from('wa_connections')
    .select('account_id,phone_number_id,token_ciphertext,status').eq('phone_number_id', phoneNumberId);
  if (error || !rows) return { status: 'not_connected' };
  if (rows.length === 0) return { status: 'not_found' };
  if (rows.length !== 1 || rows[0].status !== 'connected') return { status: 'not_connected' };
  // profiles.account_role is defined in wacrm_schema.sql and used by getCurrentAccount.
  const { data: owner, error: ownerError } = await db.from('profiles')
    .select('user_id').eq('account_id', rows[0].account_id).eq('account_role', 'owner')
    .order('user_id').limit(1).maybeSingle();
  if (ownerError || !owner) return { status: 'not_connected' };
  try {
    return { status: 'connected', connection: {
      account_id: rows[0].account_id, user_id: owner.user_id,
      accessToken: decryptToken(rows[0].token_ciphertext),
    } };
  } catch { return { status: 'not_connected' }; } // Corrupt/rotated ciphertext must also fail closed.
}

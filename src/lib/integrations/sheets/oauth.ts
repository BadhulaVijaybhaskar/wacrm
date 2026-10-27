/**
 * Google OAuth scaffold for Sheets sync.
 * Live token exchange is stubbed under META_STUB / INTEGRATIONS_STUB.
 */

import { isIntegrationsStubMode } from '@/lib/integrations/stub';

export function buildGoogleOAuthAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ].join(' '),
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleAuthCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ access_token: string; refresh_token?: string; stub: boolean }> {
  if (!isIntegrationsStubMode()) {
    throw new Error(
      'Live Google OAuth exchange is not enabled. Set META_STUB=1 or INTEGRATIONS_STUB=1.',
    );
  }
  if (!opts.code.trim()) {
    throw new Error('Missing authorization code');
  }
  return {
    access_token: `stub_access_${opts.code.slice(0, 8)}`,
    refresh_token: `stub_refresh_${opts.code.slice(0, 8)}`,
    stub: true,
  };
}

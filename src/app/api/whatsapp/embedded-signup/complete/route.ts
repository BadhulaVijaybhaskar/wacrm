import {callbackStateSecret,CALLBACK_COOKIE,validCallbackState} from '@/lib/whatsapp/embedded-signup/callback-state';
import { NextResponse } from 'next/server';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { connect, enabled, publicError, signupInput, SignupError } from '@/lib/whatsapp/embedded-signup/core';
function isJsonRequest(request: Request): boolean {
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  return type === 'application/json';
}

function readCookie(request: Request, name: string): string | undefined {
  return (request.headers.get('cookie') || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(name + '='))
    ?.slice(name.length + 1);
}

function toOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

// Browsers always send Origin on cross-site POSTs; a missing header is non-browser traffic.
function isAppOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  const allowed = [
    toOrigin(request.url),
    toOrigin(process.env.NEXT_PUBLIC_SITE_URL?.trim()),
    toOrigin(process.env.NEXT_PUBLIC_APP_URL?.trim()),
  ];
  return allowed.includes(origin);
}

// Browsers label cross-site requests; reject them even if Origin looks acceptable.
function isCrossSite(request: Request): boolean {
  return request.headers.get('sec-fetch-site') === 'cross-site';
}

export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // The callback state cookie is single-use: every response after a
  // validation attempt (success or any rejection) clears it.
  const reply = (response: NextResponse) => {
    response.cookies.set(CALLBACK_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/whatsapp/embedded-signup/complete',
      maxAge: 0,
    });
    return response;
  };
  if (!isJsonRequest(request)) return reply(NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 }));
  if (isCrossSite(request) || !isAppOrigin(request)) return reply(NextResponse.json({ error: 'forbidden_origin' }, { status: 403 }));
  try {
    const ctx = await requireRole('admin');
    const input = signupInput.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new SignupError('invalid_request', 400);
    const cookie = readCookie(request, CALLBACK_COOKIE);
    const secret = callbackStateSecret();
    if (!validCallbackState(input.data.state, cookie, ctx.accountId, secret)) {
      throw new SignupError('callback_state_invalid', 403);
    }
    return reply(NextResponse.json(await connect(input.data, ctx.accountId)));
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return reply(NextResponse.json({ error: 'forbidden' }, { status: error.status }));
    }
    const result = publicError(error);
    return reply(NextResponse.json(result.body, { status: result.status }));
  }
}

import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { connect, enabled, publicError, signupInput, SignupError } from '@/lib/whatsapp/embedded-signup/core';
export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    const ctx = await requireRole('admin');
    const input = signupInput.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new SignupError('invalid_request', 400);
    return NextResponse.json(await connect(input.data, ctx.accountId));
  } catch (error) {
    const result = publicError(error);
    // Auth errors must preserve 403, even for absent session.
    const status = error instanceof Error && 'status' in error && (error as {status:number}).status <= 403
      ? 403 : result.status;
    return NextResponse.json(status === 403 && !(error instanceof SignupError)
      ? {error:'forbidden'} : result.body, {status});
  }
}

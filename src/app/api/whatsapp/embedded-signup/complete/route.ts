import { NextResponse } from 'next/server';
import { requireRole, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';
import { connect, enabled, publicError, signupInput, SignupError } from '@/lib/whatsapp/embedded-signup/core';
export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    const ctx = await requireRole('admin');
    const input = signupInput.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new SignupError('invalid_request', 400);
    return NextResponse.json(await connect(input.data, ctx.accountId));
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'forbidden' }, { status: error.status });
    }
    const result = publicError(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

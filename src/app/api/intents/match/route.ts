import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { detectIntentHints } from '@/lib/intents/load';

/**
 * POST /api/intents/match — test local keyword matching (no Connect call).
 * Body: { text: string }
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const body = await request.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }
    const hints = await detectIntentHints(supabase, accountId, text);
    return NextResponse.json({ hints });
  } catch (err) {
    return toErrorResponse(err);
  }
}

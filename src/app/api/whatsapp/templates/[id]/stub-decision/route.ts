import { NextResponse } from 'next/server';
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  isDryRunTemplateId,
  isStubDecision,
  isTemplatesDryRun,
} from '@/lib/whatsapp/templates-dry-run';

/**
 * Simulate Meta template approval outcomes when running without a real
 * WABA (WHATSAPP_TEMPLATES_DRY_RUN or META_STUB). Real Meta statuses
 * still arrive via the webhook path.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    if (!isTemplatesDryRun()) {
      return NextResponse.json(
        {
          error:
            'Stub decisions are only available when WHATSAPP_TEMPLATES_DRY_RUN or META_STUB is enabled.',
        },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid template id.' }, { status: 400 });
    }

    const { supabase, accountId } = await requireRole('admin');

    let body: { decision?: unknown; reason?: unknown };
    try {
      body = (await request.json()) as { decision?: unknown; reason?: unknown };
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (!isStubDecision(body.decision)) {
      return NextResponse.json(
        { error: 'decision must be APPROVED or REJECTED.' },
        { status: 400 },
      );
    }

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, status, meta_template_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 });
    }

    if (!isDryRunTemplateId(existing.meta_template_id)) {
      return NextResponse.json(
        {
          error:
            'Only dry-run / stub templates can be decided here. Live Meta templates update via webhook.',
        },
        { status: 400 },
      );
    }

    if (existing.status !== 'PENDING') {
      return NextResponse.json(
        { error: `Only PENDING templates can be decided (got ${existing.status}).` },
        { status: 400 },
      );
    }

    const reason =
      body.decision === 'REJECTED'
        ? typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'Rejected by Meta stub'
        : null;

    const { data: row, error: updErr } = await supabase
      .from('message_templates')
      .update({
        status: body.decision,
        rejection_reason: reason,
        submission_error: null,
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select()
      .single();

    if (updErr) {
      return NextResponse.json(
        { error: `Failed to update status: ${updErr.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, template: row, stub: true });
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error);
    }
    console.error('Error in stub-decision:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Stub decision failed.' },
      { status: 500 },
    );
  }
}

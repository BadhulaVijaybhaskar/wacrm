import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/intents/[id] — update intent + replace phrases/entities. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof body.display_name === 'string') {
      patch.display_name = body.display_name.trim();
    }
    if (typeof body.description === 'string' || body.description === null) {
      patch.description = body.description;
    }
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if ('trigger_flow_id' in body) {
      patch.trigger_flow_id = body.trigger_flow_id || null;
    }
    if ('trigger_automation_id' in body) {
      patch.trigger_automation_id = body.trigger_automation_id || null;
    }

    const { data: intent, error } = await supabase
      .from('intents')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    if (!intent) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (Array.isArray(body.phrases)) {
      await supabase.from('intent_training_phrases').delete().eq('intent_id', id);
      const phrases = body.phrases.filter(
        (p: unknown) => typeof p === 'string' && String(p).trim(),
      ) as string[];
      if (phrases.length) {
        await supabase.from('intent_training_phrases').insert(
          phrases.map((phrase) => ({ intent_id: id, phrase: phrase.trim() })),
        );
      }
    }

    if (Array.isArray(body.entities)) {
      await supabase.from('intent_entities').delete().eq('intent_id', id);
      const entities = body.entities as Array<{
        name: string;
        entity_type?: string;
        required?: boolean;
      }>;
      if (entities.length) {
        await supabase.from('intent_entities').insert(
          entities
            .filter((e) => typeof e.name === 'string' && e.name.trim())
            .map((e) => ({
              intent_id: id,
              name: e.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
              entity_type: e.entity_type || 'text',
              required: Boolean(e.required),
            })),
        );
      }
    }

    return NextResponse.json({ intent });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** DELETE /api/intents/[id] */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;
    const { error } = await supabase
      .from('intents')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);
    if (error) {
      return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/** GET /api/intents — list intents with phrases + entities. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');

    const { data, error } = await supabase
      .from('intents')
      .select(
        '*, intent_training_phrases(id, phrase), intent_entities(id, name, entity_type, required)',
      )
      .eq('account_id', accountId)
      .order('display_name', { ascending: true });

    if (error) {
      console.error('[intents] list:', error.message);
      return NextResponse.json({ error: 'Failed to list intents' }, { status: 500 });
    }
    return NextResponse.json({ intents: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST /api/intents — create intent with optional phrases/entities. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const body = await request.json().catch(() => null);
    if (!body || typeof body.name !== 'string' || typeof body.display_name !== 'string') {
      return NextResponse.json(
        { error: 'name and display_name are required' },
        { status: 400 },
      );
    }
    const name = body.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!name) {
      return NextResponse.json({ error: 'invalid name' }, { status: 400 });
    }

    const { data: intent, error } = await supabase
      .from('intents')
      .insert({
        account_id: accountId,
        name,
        display_name: body.display_name.trim(),
        description:
          typeof body.description === 'string' ? body.description : null,
        enabled: body.enabled !== false,
        trigger_flow_id: body.trigger_flow_id || null,
        trigger_automation_id: body.trigger_automation_id || null,
      })
      .select('*')
      .single();

    if (error || !intent) {
      console.error('[intents] create:', error?.message);
      return NextResponse.json(
        { error: error?.message?.includes('duplicate') ? 'Name already exists' : 'Failed to create' },
        { status: 400 },
      );
    }

    const phrases: string[] = Array.isArray(body.phrases)
      ? body.phrases.filter((p: unknown) => typeof p === 'string' && p.trim())
      : [];
    if (phrases.length) {
      await supabase.from('intent_training_phrases').insert(
        phrases.map((phrase) => ({ intent_id: intent.id, phrase: phrase.trim() })),
      );
    }

    const entities: Array<{
      name: string;
      entity_type?: string;
      required?: boolean;
    }> = Array.isArray(body.entities) ? body.entities : [];
    if (entities.length) {
      await supabase.from('intent_entities').insert(
        entities
          .filter((e) => typeof e.name === 'string' && e.name.trim())
          .map((e) => ({
            intent_id: intent.id,
            name: e.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
            entity_type: e.entity_type || 'text',
            required: Boolean(e.required),
          })),
      );
    }

    return NextResponse.json({ intent }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

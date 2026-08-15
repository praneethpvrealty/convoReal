import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { GREETING_MESSAGE_MAX } from '@/lib/greetings/generate';

// PATCH /api/greetings/[id] — edit a greeting's message or card image
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const updates: Record<string, unknown> = {};

    if (typeof body?.messageText === 'string') {
      const messageText = body.messageText.replace(/\s+/g, ' ').trim();
      if (!messageText) {
        return NextResponse.json(
          { error: 'Greeting message cannot be empty' },
          { status: 400 }
        );
      }
      if (messageText.length > GREETING_MESSAGE_MAX) {
        return NextResponse.json(
          {
            error: `Greeting must stay under ${GREETING_MESSAGE_MAX} characters`,
          },
          { status: 400 }
        );
      }
      updates.message_text = messageText;
    }
    if ('imagePath' in (body ?? {})) {
      updates.image_path =
        typeof body.imagePath === 'string' && body.imagePath.trim()
          ? body.imagePath.trim()
          : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('occasion_greetings')
      .update(updates)
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('*');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Greeting not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: data[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/greetings/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;

    const { data: deleted, error } = await ctx.supabase
      .from('occasion_greetings')
      .delete()
      .eq('account_id', ctx.accountId)
      .eq('id', id)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { error: 'Greeting not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: { id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeServices } from '@/lib/liaisons/services';

// POST /api/liaisons — add a person to the liaisoning directory.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:createLiaison:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { name, phone, alt_phone, email, office_area, services, notes } = body;

    // Validation
    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: "'name' is required" },
        { status: 400 },
      );
    }

    const liaisonData = {
      user_id: ctx.userId,
      account_id: ctx.accountId,
      name: name.trim(),
      phone: typeof phone === 'string' ? phone.trim() || null : null,
      alt_phone: typeof alt_phone === 'string' ? alt_phone.trim() || null : null,
      email: typeof email === 'string' ? email.trim() || null : null,
      office_area: typeof office_area === 'string' ? office_area.trim() || null : null,
      services: sanitizeServices(services),
      notes: typeof notes === 'string' ? notes.trim() || null : null,
    };

    const { data: created, error: insertErr } = await ctx.supabase
      .from('liaisons')
      .insert(liaisonData)
      .select('id')
      .single();

    if (insertErr || !created) {
      console.error('[POST /api/liaisons] Insert error:', insertErr);
      return NextResponse.json(
        { error: insertErr?.message ?? 'Failed to create liaison' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

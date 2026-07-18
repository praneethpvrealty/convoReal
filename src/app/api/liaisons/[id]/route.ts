import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sanitizeServices } from '@/lib/liaisons/services';

// PUT /api/liaisons/[id] — update a liaisoning directory entry.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: liaisonId } = await params;

    const limit = checkRateLimit(
      `agent:updateLiaison:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { name, phone, alt_phone, email, office_area, services, notes, is_active } = body;

    // Validation
    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: "'name' is required" },
        { status: 400 },
      );
    }

    const fieldsToSave = {
      name: name.trim(),
      phone: typeof phone === 'string' ? phone.trim() || null : null,
      alt_phone: typeof alt_phone === 'string' ? alt_phone.trim() || null : null,
      email: typeof email === 'string' ? email.trim() || null : null,
      office_area: typeof office_area === 'string' ? office_area.trim() || null : null,
      services: sanitizeServices(services),
      notes: typeof notes === 'string' ? notes.trim() || null : null,
      is_active: typeof is_active === 'boolean' ? is_active : true,
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await ctx.supabase
      .from('liaisons')
      .update(fieldsToSave)
      .eq('id', liaisonId);

    if (updateErr) {
      console.error('[PUT /api/liaisons/[id]] Update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update liaison' },
        { status: 500 },
      );
    }

    return NextResponse.json({ id: liaisonId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

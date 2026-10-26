import { NextResponse } from 'next/server';
import { requireWriteRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import {
  importSharedProperty,
  UUID_RE,
} from '@/lib/inventory/import-shared-property';

/**
 * POST /api/inventory/import-shared
 *
 * Imports a co-broker-shared property (the ?property_id=...&mode=view
 * link another brokerage sent on WhatsApp) into the caller's own
 * inventory. See importSharedProperty for what is copied and what is
 * withheld.
 */

function extractPropertyId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (UUID_RE.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const fromQuery = url.searchParams.get('property_id');
    if (fromQuery && UUID_RE.test(fromQuery)) return fromQuery;
  } catch {
    return null;
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(
      `agent:importSharedProperty:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const gate = await checkPlanLimit(ctx, 'properties');
    if (!gate.allowed) return gateResponse(gate);

    const body = await request.json().catch(() => null);
    const sourceId = extractPropertyId(body?.url ?? body?.property_id);
    if (!sourceId) {
      return NextResponse.json(
        { error: 'Paste a shared property link or property id' },
        { status: 400 }
      );
    }

    const result = await importSharedProperty(ctx, sourceId);
    switch (result.kind) {
      case 'not_found':
        return NextResponse.json(
          { error: 'Shared property not found' },
          { status: 404 }
        );
      case 'withheld':
        return NextResponse.json(
          { error: 'This listing is confidential and cannot be imported' },
          { status: 403 }
        );
      case 'own_listing':
        return NextResponse.json(
          { error: 'This property is already in your inventory' },
          { status: 409 }
        );
      case 'already_imported':
        return NextResponse.json({
          data: { id: result.id, alreadyImported: true },
        });
      case 'imported':
        return NextResponse.json(
          { data: { id: result.id, title: result.title } },
          { status: 201 }
        );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import {
  parseNextSourceChunk,
  requireGuidanceAdmin,
} from '@/lib/guidance-value/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const maxDuration = 300;

// POST /api/admin/guidance-values/sources/[id]/parse
//
// Parses the next few pages and returns the updated source. The admin
// screen calls it repeatedly until the status is `ready`, so no single
// request has to outlive a function timeout.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireGuidanceAdmin();
    const { id } = await params;
    try {
      const source = await parseNextSourceChunk(supabaseAdmin(), id);
      return NextResponse.json({ data: source });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[guidance-value] parse failed:', message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

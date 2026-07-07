import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { hasGoogleMapsKey, placesAutocomplete } from '@/lib/maps/google-places';

// Debounced typing still produces a burst of calls per search; 120/min
// per user is generous for humans while capping runaway loops.
const AUTOCOMPLETE_LIMIT = { limit: 120, windowMs: 60_000 };

// GET /api/maps/autocomplete?input=hsr&session=<uuid>
//
// Server-side proxy for Google Places Autocomplete so the API key
// never reaches the browser. The `session` token groups a typing
// session with its eventual place-details pick for billing.
//
// Returns 501 when GOOGLE_MAPS_API_KEY isn't configured — the
// LocalityAutocomplete component degrades to a plain text input.

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRole('viewer');

    const limit = checkRateLimit(`maps:autocomplete:${ctx.userId}`, AUTOCOMPLETE_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    if (!hasGoogleMapsKey()) {
      return NextResponse.json({ error: 'Maps API not configured' }, { status: 501 });
    }

    const input = request.nextUrl.searchParams.get('input')?.trim() || '';
    const session = request.nextUrl.searchParams.get('session')?.trim() || '';
    if (input.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }
    if (!session) {
      return NextResponse.json({ error: 'session is required' }, { status: 400 });
    }

    const suggestions = await placesAutocomplete(input, session);
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[GET /api/maps/autocomplete] Error:', err);
    return toErrorResponse(err);
  }
}

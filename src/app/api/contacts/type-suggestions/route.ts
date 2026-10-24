import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { loadTypeSuggestions } from '@/lib/inventory/match-feedback-store';
import { SUGGESTION_CONTACT_CAP } from '@/lib/match-feedback';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/contacts/type-suggestions
// { contactIds } → { data: { [contactId]: PROPERTY_TYPE_OPTIONS id } }
// A type to confirm for each listed contact whose "Not a fit" marks and
// enquiries point at one. The web Matching Contacts list ranks in the
// browser, so it sends the matched contacts whose type is not on file,
// in rank order; the ids travel in the body, not the URL.
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const body = (await request.json().catch(() => null)) as {
      contactIds?: unknown;
    } | null;
    const raw = body?.contactIds;
    if (
      !Array.isArray(raw) ||
      raw.length > SUGGESTION_CONTACT_CAP ||
      raw.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) {
      return NextResponse.json(
        {
          error: `contactIds must be up to ${SUGGESTION_CONTACT_CAP} contact ids`,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({
      data: await loadTypeSuggestions(
        ctx.supabase,
        ctx.accountId,
        raw as string[]
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

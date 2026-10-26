import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireWriteRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { checkPlanLimit, gateResponse } from '@/lib/billing/gates';
import {
  findImportedCopy,
  importSharedProperty,
  lookupSharedPropertySource,
  UUID_RE,
} from '@/lib/inventory/import-shared-property';
import { isTeaserGated } from '@/lib/inventory/showcase-visibility';
import { isAppSiteOrigin } from '@/lib/showcase/app-origin';

/**
 * The showcase's "Add to my inventory" control, for a signed-in member
 * of another account browsing a listing.
 *
 *   GET  ?property_id=<uuid>  → who the visitor is to this listing
 *   POST { property_id }      → import it (importSharedProperty)
 *
 * A tenant showcase is served from `<label>.<baseDomain>` while the
 * session cookie is host-only to the app origin, so the showcase calls
 * this route on the app origin with credentials. The browser lets that
 * read through only with the CORS headers below, which are answered
 * solely for the app's own showcase origins (isAppSiteOrigin): every one
 * of them runs this application's code and nothing else. The session
 * cookie is still what authenticates the call; the headers only let a
 * same-site page read the answer.
 */

export interface ShowcaseImportViewer {
  /** The listing belongs to the visitor's own account. */
  own: boolean;
  /** The visitor may write to their inventory (agent or above, not read-only). */
  canImport: boolean;
  /** This account's existing copy of the listing, when it has one. */
  importedId: string | null;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!isAppSiteOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin as string,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function withCors(request: Request, response: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders(request))) {
    response.headers.set(key, value);
  }
  return response;
}

export async function OPTIONS(request: Request) {
  return withCors(request, new NextResponse(null, { status: 204 }));
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const propertyId = new URL(request.url).searchParams.get('property_id');
    if (!propertyId || !UUID_RE.test(propertyId)) {
      return withCors(
        request,
        NextResponse.json({ error: 'property_id is required' }, { status: 400 })
      );
    }

    const source = await lookupSharedPropertySource(propertyId);
    if (!source) {
      return withCors(
        request,
        NextResponse.json({ error: 'Property not found' }, { status: 404 })
      );
    }

    const own = source.account_id === ctx.accountId;
    const imported = own ? null : await findImportedCopy(ctx, source.id);
    const viewer: ShowcaseImportViewer = {
      own,
      canImport:
        !own &&
        !ctx.isReadOnly &&
        hasMinRole(ctx.role, 'agent') &&
        !isTeaserGated(source),
      importedId: imported?.id ?? null,
    };
    return withCors(
      request,
      NextResponse.json(
        { data: viewer },
        { headers: { 'Cache-Control': 'private, no-store' } }
      )
    );
  } catch (err) {
    return withCors(request, toErrorResponse(err));
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireWriteRole('agent');

    const limit = await checkRateLimit(
      `agent:importSharedProperty:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return withCors(request, rateLimitResponse(limit));

    const gate = await checkPlanLimit(ctx, 'properties');
    if (!gate.allowed) return withCors(request, gateResponse(gate));

    const body = await request.json().catch(() => null);
    const propertyId =
      typeof body?.property_id === 'string' ? body.property_id.trim() : '';
    if (!UUID_RE.test(propertyId)) {
      return withCors(
        request,
        NextResponse.json({ error: 'property_id is required' }, { status: 400 })
      );
    }

    const result = await importSharedProperty(ctx, propertyId);
    switch (result.kind) {
      case 'not_found':
        return withCors(
          request,
          NextResponse.json({ error: 'Property not found' }, { status: 404 })
        );
      case 'withheld':
        return withCors(
          request,
          NextResponse.json(
            { error: 'This listing is confidential and cannot be imported' },
            { status: 403 }
          )
        );
      case 'own_listing':
        return withCors(
          request,
          NextResponse.json(
            { error: 'This property is already in your inventory' },
            { status: 409 }
          )
        );
      case 'already_imported':
        return withCors(
          request,
          NextResponse.json({
            data: { id: result.id, alreadyImported: true },
          })
        );
      case 'imported':
        return withCors(
          request,
          NextResponse.json(
            { data: { id: result.id, title: result.title } },
            { status: 201 }
          )
        );
    }
  } catch (err) {
    return withCors(request, toErrorResponse(err));
  }
}

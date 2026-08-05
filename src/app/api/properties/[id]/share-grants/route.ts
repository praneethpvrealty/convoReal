import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { canViewExactLocation } from '@/lib/inventory/location-guard';
import {
  mintShareGrantToken,
  type ShareGrant,
} from '@/lib/inventory/share-grants';
import type { Property } from '@/types';

// GET /api/properties/[id]/share-grants
// Live grants for the property, newest first — the share dialog shows
// what is currently unmasked so it can be revoked.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: propertyId } = await params;

    const { data, error } = await ctx.supabase
      .from('property_share_grants')
      .select('*, contact:contacts(id, name, phone)')
      .eq('property_id', propertyId)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/properties/[id]/share-grants]', error);
      return NextResponse.json(
        { error: 'Failed to fetch share grants' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// POST /api/properties/[id]/share-grants
// Mints a pre-approved reveal for one share. Body:
//   { contact_id?: string, reveal_location?: bool, reveal_documents?: bool }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: propertyId } = await params;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const revealLocation = body.reveal_location === true;
    const revealDocuments = body.reveal_documents === true;
    const revealPrivateImages = body.reveal_private_images === true;
    if (!revealLocation && !revealDocuments && !revealPrivateImages) {
      return NextResponse.json(
        { error: 'Grant must reveal at least one thing' },
        { status: 400 }
      );
    }

    const { data: property } = await ctx.supabase
      .from('properties')
      .select('id, type, user_id, location_privacy, documents, private_images')
      .eq('id', propertyId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!property) {
      return NextResponse.json(
        { error: 'Property not found' },
        { status: 404 }
      );
    }

    // An agent who cannot see a guarded listing's exact pin themselves
    // must not be able to hand it to a buyer — same rule the internal
    // read path enforces, applied to the grant. Guarded photos ride the
    // same check: a facade identifies a house on the ground the way its
    // address does, which is why they are held back in the first place.
    if (
      (revealLocation || revealPrivateImages) &&
      !canViewExactLocation(
        { role: ctx.role, userId: ctx.userId },
        property as Pick<Property, 'type' | 'user_id' | 'location_privacy'>
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Only an admin or this listing's own agent can reveal its exact location or guarded photos",
        },
        { status: 403 }
      );
    }

    const docs = Array.isArray((property as Property).documents)
      ? (property as Property).documents!.filter((d) => d?.trim())
      : [];
    if (revealDocuments && docs.length === 0) {
      return NextResponse.json(
        { error: 'This property has no documents to share' },
        { status: 400 }
      );
    }

    const privateImages = Array.isArray((property as Property).private_images)
      ? (property as Property).private_images!.filter((p) => p?.trim())
      : [];
    if (revealPrivateImages && privateImages.length === 0) {
      return NextResponse.json(
        { error: 'This property has no guarded photos to share' },
        { status: 400 }
      );
    }

    // A contact-bound grant is a per-recipient key; scope-check the
    // contact so a grant cannot be pinned to another account's row.
    let contactId: string | null = null;
    if (typeof body.contact_id === 'string' && body.contact_id) {
      const { data: contact } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('id', body.contact_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!contact) {
        return NextResponse.json(
          { error: 'Contact not found' },
          { status: 404 }
        );
      }
      contactId = contact.id;
    }

    const { token, expiresAt } = mintShareGrantToken();

    const { data: grant, error } = await ctx.supabase
      .from('property_share_grants')
      .insert({
        account_id: ctx.accountId,
        property_id: propertyId,
        contact_id: contactId,
        created_by: ctx.userId,
        token,
        reveal_location: revealLocation,
        reveal_documents: revealDocuments,
        reveal_private_images: revealPrivateImages,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/properties/[id]/share-grants]', error);
      return NextResponse.json(
        { error: 'Failed to mint share grant' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: grant as ShareGrant });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/properties/[id]/share-grants?grant_id=<uuid>
// Revokes a grant — the link it rides on returns to the masked default
// on the next open.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: propertyId } = await params;

    const grantId = new URL(request.url).searchParams.get('grant_id');
    if (!grantId) {
      return NextResponse.json({ error: 'grant_id required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('property_share_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', grantId)
      .eq('property_id', propertyId)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/properties/[id]/share-grants]', error);
      return NextResponse.json(
        { error: 'Failed to revoke share grant' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id: data.id } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  canTransition,
  DEAL_DOCUMENT_BUCKET,
  INVOICE_BUCKET,
  isEditable,
  SIGNATURE_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from './server';
import type { InvoiceStatus } from './types';

function repoSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const ALL: InvoiceStatus[] = ['draft', 'issued', 'sent', 'paid', 'cancelled'];

describe('invoice status transitions', () => {
  // [INV-001] A spent number is never handed back.
  it('never lets an issued invoice return to draft', () => {
    for (const status of ALL) {
      if (status === 'draft') continue;
      expect(canTransition(status, 'draft')).toBe(false);
    }
  });

  it('walks the ordinary path', () => {
    expect(canTransition('draft', 'issued')).toBe(true);
    expect(canTransition('issued', 'sent')).toBe(true);
    expect(canTransition('sent', 'paid')).toBe(true);
  });

  it('allows marking paid without a send, since payment can arrive first', () => {
    expect(canTransition('issued', 'paid')).toBe(true);
  });

  it('allows cancellation from anywhere except a cancelled invoice', () => {
    for (const status of ALL) {
      expect(canTransition(status, 'cancelled')).toBe(status !== 'cancelled');
    }
  });

  it('treats a cancelled invoice as terminal', () => {
    expect(ALLOWED_TRANSITIONS.cancelled).toEqual([]);
  });

  it('never allows a transition to itself', () => {
    for (const status of ALL) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});

describe('isEditable', () => {
  // [INV-002] Only a draft can be edited; everything else is a record.
  it('is true only for a draft', () => {
    expect(isEditable('draft')).toBe(true);
    for (const status of ALL.filter((s) => s !== 'draft')) {
      expect(isEditable(status)).toBe(false);
    }
  });
});

describe('deal documents are never reachable by URL alone', () => {
  // [INV-005] These buckets hold Aadhaars, sale deeds and a scanned
  // signature. `property-documents` is PUBLIC, which is why none of
  // this reuses it — a public object URL is the only thing between a
  // guess and a customer's identity document.
  const migration = repoSource('supabase/migrations/20260914120200_deal_documents.sql');

  it('creates every bucket private', () => {
    for (const bucket of [
      DEAL_DOCUMENT_BUCKET,
      INVOICE_BUCKET,
      SIGNATURE_BUCKET,
    ]) {
      const declaration = migration.slice(
        migration.indexOf(`'${bucket}',`),
        migration.indexOf(`'${bucket}',`) + 400
      );
      expect(declaration, `${bucket} must be created private`).toContain(
        'FALSE'
      );
      expect(declaration).not.toMatch(/\bTRUE\b/);
    }
  });

  it('serves a document through an authed route that signs a short URL', () => {
    const route = repoSource(
      'src/app/api/deals/[id]/documents/[docId]/route.ts'
    );
    // Membership is proved first, and only then is a URL signed.
    expect(route).toContain("requireRole('agent')");
    expect(route).toContain('signedUrlFor');
    expect(route).toContain('NextResponse.redirect');
    // A row whose path points outside the private bucket is refused
    // rather than signed, whatever wrote it.
    expect(route).toContain('startsWith(`${DEAL_DOCUMENT_BUCKET}/`)');
    // A public URL would defeat the whole arrangement.
    expect(route).not.toContain('storagePublicUrl');
  });

  it('never returns an object URL from the listing', () => {
    const listing = repoSource('src/app/api/deals/[id]/documents/route.ts');
    expect(listing).not.toContain('createSignedUrl');
    expect(listing).not.toContain('storagePublicUrl');
    expect(listing).not.toContain('getPublicUrl');
  });

  it('signs links for an hour, not indefinitely', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(3600);
  });
});

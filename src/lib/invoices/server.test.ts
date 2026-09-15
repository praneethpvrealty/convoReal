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
  const migration = repoSource(
    'supabase/migrations/20260914120200_deal_documents.sql'
  );

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

describe('an invoice only claims a signature it has', () => {
  // [INV-002] The settings default is image mode, and an account that
  // has uploaded nothing must not have "Electronically signed" printed
  // on its invoices. The issue route resolves the image first and lets
  // signed_at follow from it.
  const issueRoute = repoSource('src/app/api/invoices/[id]/issue/route.ts');

  it('derives signed_at from the resolved image, not from the mode', () => {
    expect(issueRoute).toContain('resolveSignatureImage');
    expect(issueRoute).toContain(
      'const signedAt = signatureImage ? new Date().toISOString() : null'
    );
    // The old rule — signed because the mode says image — is gone.
    expect(issueRoute).not.toContain("mode === 'image' ? issuedAt");
  });

  it('carries that same decision into the atomic issue call', () => {
    expect(issueRoute).toContain('p_signed_at: signedAt');
  });

  it('renders the same image it judged the signature by', () => {
    // Loading it twice could disagree with itself if the object went
    // away between the two reads.
    expect(issueRoute).toContain('renderInvoice(numbered, { signatureImage })');
  });

  it('has an upload route, so image mode can actually be satisfied', () => {
    const upload = repoSource(
      'src/app/api/invoice-settings/signature/route.ts'
    );
    expect(upload).toContain("requireRole('admin')");
    expect(upload).toContain('SIGNATURE_BUCKET');
    expect(upload).toContain('signature_image_path');
    // Clearing the image drops out of image mode rather than leaving an
    // account claiming a signature it just deleted.
    expect(upload).toContain("signature_mode: 'none'");
  });

  it('never takes the signature path as a free-form string', () => {
    // An arbitrary path would reach another account's object in the
    // shared bucket.
    const settings = repoSource('src/app/api/invoice-settings/route.ts');
    const writable = settings.slice(
      settings.indexOf('const TEXT_FIELDS'),
      settings.indexOf('] as const;')
    );
    expect(writable).not.toContain('signature_image_path');
  });
});

describe('immutability is enforced by the database, not only the API', () => {
  // [INV-002] Both surfaces hold an anon key and a member JWT and talk
  // to PostgREST directly, so a `FOR ALL` policy would let an agent
  // PATCH an issued invoice's totals or DELETE it — taking its audit
  // events with it — without any route running. Verified against the
  // live database when applied: tampering with grand_total or bill_to,
  // and reverting to draft, all raise; issue, send, paid and cancel all
  // pass.
  const migration = repoSource(
    'supabase/migrations/20260914173000_invoice_immutability.sql'
  );

  it('replaces the blanket FOR ALL policy with one per verb', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS invoices_modify');
    for (const verb of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(migration).toContain(`FOR ${verb}`);
    }
  });

  it('holds DELETE to drafts, so a number is never removed from a series', () => {
    const policy = migration.slice(
      migration.indexOf('invoices_delete ON invoices')
    );
    expect(policy).toContain("status = 'draft'");
  });

  it('freezes every field the printed document asserts', () => {
    const trigger = migration.slice(
      migration.indexOf(
        'CREATE OR REPLACE FUNCTION enforce_invoice_immutability'
      ),
      migration.indexOf('DROP TRIGGER')
    );
    for (const frozen of [
      'invoice_number',
      'grand_total',
      'taxable_total',
      'bill_to',
      'issuer',
      'line_items',
      'gst_mode',
      'share_percent',
      'invoice_date',
    ]) {
      expect(trigger, `${frozen} must be frozen after issue`).toContain(
        `NEW.${frozen}`
      );
    }
    // Deliberately mutable after issue: the status timeline, and the
    // signature trio a DSC or eSign provider fills in later.
    for (const mutable of ['NEW.status', 'NEW.signed_at', 'NEW.pdf_path']) {
      expect(trigger).not.toContain(`${mutable},`);
    }
  });

  it('refuses to send an issued invoice back to draft', () => {
    expect(migration).toContain('An issued invoice cannot return to draft');
  });

  it('mirrors the transition graph the API enforces', () => {
    expect(migration).toContain('A cancelled invoice cannot be reopened');
    expect(migration).toContain('A paid invoice can only be cancelled');
    expect(ALLOWED_TRANSITIONS.cancelled).toEqual([]);
    expect(ALLOWED_TRANSITIONS.paid).toEqual(['cancelled']);
  });
});

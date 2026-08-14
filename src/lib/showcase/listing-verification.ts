// ============================================================
// Seller listing — reverse WhatsApp verification.
//
// The public /list page stashes a seller's raw listing (text +
// photos) in public_listing_submissions with a short code (see
// migration 098). The seller sends that code to the agent's WhatsApp;
// the inbound webhook calls processListingVerification() to match the
// code, verify the sender owns the number, parse the stashed content
// (credit-metered — happens ONLY here, post-verification, so
// unverified web traffic can't drain the agent's credits), and create
// a Pending-Review property owned by the sender's contact.
//
// The external/inbound engine stays soft on credits (never blocks a
// prospect) — consistent with the buyer Q&A funnel and the WhatsApp
// external-listing flow.
// ============================================================

import { randomInt } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseListingFromImageOrText } from '@/lib/ai/gemini';
import {
  validateDraft,
  backfillLocationFromMapLink,
} from '@/lib/ai/intake-core';
import { extractImagesFromPdf } from '@/lib/pdf/image-extractor';
import { sanitizeFloorTenancies } from '@/lib/inventory/floor-tenancies';
import { uploadPropertyImage } from '@/lib/storage/upload';
import { storagePublicUrl } from '@/lib/storage/url';
import { burnCredits } from '@/lib/credits/burn';
import { AI_FEATURE_COSTS } from '@/lib/credits/types';
import { recordRequirementResponse } from '@/lib/requirements/respond';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

/** Download a submitted brochure from our own storage. Bounded and
 *  non-fatal: a missing or oversized object degrades to the text-only
 *  parse rather than failing the verification. */
async function fetchStoredPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(storagePublicUrl(url));
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) return null;
    return bytes;
  } catch (err) {
    console.error('[listing-verification] brochure fetch failed:', err);
    return null;
  }
}

// Unambiguous alphabet — no 0/O/1/I/L to avoid transcription errors
// when a seller types the code into WhatsApp.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 4;
const CODE_PREFIX = 'LIST-';

/** Generates a short verification code like `LIST-A7K2`. */
export function generateSubmissionCode(): string {
  let body = '';
  for (let i = 0; i < CODE_LEN; i++) {
    body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return CODE_PREFIX + body;
}

// Matches the code anywhere in a free-form message, case-insensitively.
// Restricted to the code alphabet so it can't match random words.
const CODE_RE = new RegExp(`\\bLIST-([${CODE_ALPHABET}]{${CODE_LEN}})\\b`, 'i');

/** Extracts a submission code from an inbound message, or null. */
export function extractSubmissionCode(
  text: string | null | undefined
): string | null {
  if (!text) return null;
  const m = text.match(CODE_RE);
  return m ? `${CODE_PREFIX}${m[1].toUpperCase()}` : null;
}

interface ContactRecord {
  id: string;
  classification?: string | null;
}

interface ProcessArgs {
  accountId: string;
  contentText: string | null;
  senderPhone: string;
  contactRecord: ContactRecord;
  conversationId: string;
}

/**
 * Called by the webhook for every inbound text. Returns true when the
 * message was a listing-verification code we handled (so the caller
 * short-circuits the normal chatbot flow), false when it wasn't one of
 * ours (fall through untouched).
 */
export async function processListingVerification(
  args: ProcessArgs
): Promise<boolean> {
  const { accountId, contentText, senderPhone, contactRecord, conversationId } =
    args;

  const code = extractSubmissionCode(contentText);
  if (!code) return false;

  const db = admin();

  const { data: submission } = await db
    .from('public_listing_submissions')
    .select('*')
    .eq('account_id', accountId)
    .eq('code', code)
    .maybeSingle();

  // Code-shaped text that isn't one of ours → not handled, fall through.
  if (!submission) return false;

  const reply = (text: string) =>
    sendWhatsAppMessageAndPersist({
      accountId,
      contactId: contactRecord.id,
      conversationId,
      toPhone: senderPhone,
      kind: 'text',
      senderType: 'bot',
      text,
    });

  // Atomic claim: flip pending -> verified in one conditional UPDATE
  // (WHERE status = 'pending' AND not expired) before doing any
  // parsing or credit burn. `created_property_id` stays NULL until the
  // property is actually created below — it distinguishes "claimed,
  // in progress" from "fully completed". Without this atomicity, two
  // concurrent deliveries of the same code (webhook redelivery, or two
  // requests racing on the sync-fallback path) could both read
  // status='pending' and both burn credits + create a duplicate
  // property. Only the caller that wins this UPDATE (gets a row back)
  // proceeds; the loser falls into the "no longer valid" branch below.
  const { data: claimed } = await db
    .from('public_listing_submissions')
    .update({
      status: 'verified',
      verified_at: new Date().toISOString(),
      verified_phone: senderPhone,
    })
    .eq('id', submission.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle();

  if (!claimed) {
    // Lost the race, already completed earlier, or expired — mark it
    // expired if that's actually why the claim failed (best-effort,
    // harmless no-op if another request already claimed it instead).
    await db
      .from('public_listing_submissions')
      .update({ status: 'expired' })
      .eq('id', submission.id)
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString());
    await reply(
      'This listing code is no longer valid — it may have already been submitted or expired. Please resubmit from the website.'
    );
    return true;
  }

  try {
    // Soft-burn the parse cost — external/inbound engine never blocks.
    try {
      await burnCredits(
        accountId,
        'listing_parse',
        AI_FEATURE_COSTS.listing_parse,
        { hardBlock: false }
      );
    } catch (err) {
      console.error(
        '[listing-verification] credit burn failed (non-fatal):',
        err
      );
    }

    // A brochure beats a paste: when the submission carries a PDF deck,
    // the deck itself is what gets parsed — Gemini reads the document
    // directly, the same path the owner chatbot has always used for
    // PDFs — and its embedded photos become the listing's gallery.
    const submittedDocs: string[] = Array.isArray(claimed.documents)
      ? claimed.documents
      : [];
    const deckBuffer =
      submittedDocs.length > 0 ? await fetchStoredPdf(submittedDocs[0]) : null;

    let draft;
    let deckImages: string[] = [];
    if (deckBuffer) {
      const [parsed, extracted] = await Promise.all([
        parseListingFromImageOrText(
          claimed.raw_text || '',
          deckBuffer,
          'application/pdf'
        ),
        extractImagesFromPdf(deckBuffer).catch(() => [] as Buffer[]),
      ]);
      draft = parsed;
      deckImages = (
        await Promise.all(
          extracted.slice(0, 15).map((buf) =>
            uploadPropertyImage(accountId, buf, 'image/jpeg').catch((err) => {
              console.error(
                '[listing-verification] deck image upload failed:',
                err
              );
              return null;
            })
          )
        )
      ).filter((u): u is string => !!u);
    } else {
      draft = await parseListingFromImageOrText(claimed.raw_text);
    }
    draft = await backfillLocationFromMapLink(draft);
    const { isValid, missingFields } = validateDraft(draft);

    // Fallbacks keep the NOT NULL insert safe even when the seller's
    // paste was thin — the agent completes it during Pending Review.
    const title = draft.title?.trim() || 'Untitled listing (pending review)';
    const location = draft.location?.trim() || 'Location pending';
    const price =
      draft.listing_type === 'Rent'
        ? draft.rent_per_month || 0
        : draft.price || 0;
    const submittedImages: string[] = Array.isArray(claimed.images)
      ? claimed.images
      : [];
    const images = [...submittedImages, ...deckImages].slice(0, 15);

    const { data: prop, error: propErr } = await db
      .from('properties')
      .insert({
        account_id: accountId,
        user_id: null,
        title,
        description:
          draft.description ||
          'Submitted via the website listing form, pending review.',
        price,
        location,
        type: draft.type || 'Others',
        status: 'Pending Review',
        bedrooms: draft.bedrooms,
        bathrooms: draft.bathrooms,
        area_sqft: draft.area_sqft,
        sublocality: draft.sublocality,
        city: draft.city || 'Bangalore',
        state: draft.state || 'Karnataka',
        dimensions: draft.dimensions,
        facing_direction: draft.facing_direction,
        is_published: false,
        features: draft.features || [],
        nearby_highlights: draft.nearby_highlights || [],
        images,
        documents: submittedDocs,
        // A commercial deck's rent roll — one row per floor. The decks
        // this feature was built for carry exactly this.
        floor_tenancies: sanitizeFloorTenancies(draft.floor_tenancies),
        rental_income: draft.rental_income,
        roi: draft.roi,
        google_map_link: draft.google_map_link,
        latitude: draft.latitude ?? null,
        longitude: draft.longitude ?? null,
        land_area: draft.land_area,
        land_area_unit: draft.land_area_unit || 'Sq.Ft.',
        owner_contact_id: contactRecord.id,
        listing_source: 'web_lister',
        listing_type: draft.listing_type || 'Sale',
        rent_per_month: draft.rent_per_month,
        maintenance: draft.maintenance,
        advance: draft.advance,
        gst: draft.gst,
        jv_structure: draft.jv_structure || null,
        owner_share_percent: draft.owner_share_percent ?? null,
        builder_share_percent: draft.builder_share_percent ?? null,
        goodwill_amount: draft.goodwill_amount ?? null,
      })
      .select('id, property_code, title, price, location, type')
      .single();

    if (propErr || !prop) {
      console.error('[listing-verification] property insert failed:', propErr);
      await revertClaim(db, submission.id);
      await reply(
        '❌ Something went wrong saving your listing. Please try again from the website.'
      );
      return true;
    }

    // Mark the sender: a co-broker answering a shared requirement is an
    // Agent, anyone else is an Owner lead (only upgrade generic contacts).
    if (
      !contactRecord.classification ||
      contactRecord.classification === 'Others'
    ) {
      const classification = claimed.requirement_link_id ? 'Agent' : 'Owner';
      await db
        .from('contacts')
        .update({ classification })
        .eq('id', contactRecord.id);
    }

    // Claim already flipped status -> 'verified' above; just attach the
    // resulting property to mark the submission fully complete.
    await db
      .from('public_listing_submissions')
      .update({ created_property_id: prop.id })
      .eq('id', submission.id);

    let requirementRef: string | null = null;
    if (claimed.requirement_link_id) {
      requirementRef = await recordRequirementResponse(
        db,
        claimed.requirement_link_id,
        {
          propertyCode: prop.property_code,
          title: prop.title,
        }
      );
    }

    let confirmation =
      `✅ *Your property listing has been submitted!*\n\n` +
      `*Code:* ${prop.property_code}\n` +
      `*Title:* ${prop.title}\n` +
      `*Price:* ₹${Number(prop.price).toLocaleString('en-IN')}\n` +
      `*Location:* ${prop.location}\n` +
      `*Type:* ${prop.type}\n`;
    if (requirementRef) {
      confirmation += `\n🤝 Submitted as a response to requirement ${requirementRef}.`;
    }
    if (!isValid) {
      confirmation += `\n📝 A few details still need confirming (${missingFields.join(', ')}) — the agent will reach out.`;
    }
    confirmation += `\n\n🕐 *Pending review* — the team will verify the details and publish it shortly.`;

    await reply(confirmation);
    return true;
  } catch (err) {
    console.error('[listing-verification] processing failed:', err);
    await revertClaim(db, submission.id);
    await reply(
      '❌ Something went wrong processing your listing. Please try again from the website.'
    );
    return true;
  }
}

/**
 * Releases a claim this call made (verified -> pending) after a
 * downstream failure, so the seller can resend the code to retry.
 * Scoped with `created_property_id IS NULL` — never touches a
 * submission that actually finished successfully.
 */
async function revertClaim(
  db: SupabaseClient,
  submissionId: string
): Promise<void> {
  try {
    await db
      .from('public_listing_submissions')
      .update({ status: 'pending' })
      .eq('id', submissionId)
      .eq('status', 'verified')
      .is('created_property_id', null);
  } catch (err) {
    console.error(
      '[listing-verification] revertClaim failed (non-fatal):',
      err
    );
  }
}

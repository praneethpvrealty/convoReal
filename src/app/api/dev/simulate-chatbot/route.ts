import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  classifyImageOrText,
  parseListingFromImageOrText,
  parseContactFromImageOrText,
  parseClientReplyFromImageOrText,
} from '@/lib/ai/gemini';
import {
  validateDraft,
  validateContactDraftsContainer,
  formatDraftPreviewMessage,
  formatContactDraftsPreview,
  backfillLocationFromMapLink,
  deriveDraftStatus,
} from '@/lib/ai/intake-core';
import { parseEventFromInput, istLocalToUtcIso } from '@/lib/calendar/event-parse';
import {
  buildQualificationReply,
  carriesRequirementSignal,
  appendRequirement,
  tallyAreaSuggestions,
} from '@/lib/ai/buyer-qualification';
import {
  routeLeadMessage,
  LEAD_ROUTE_EXPLANATIONS,
  type LeadRoute,
} from '@/lib/ai/lead-routing';
import {
  buildPhotoReplyText,
  photoHandoverText,
  plannedPhotoCount,
} from '@/lib/ai/photo-request';
import { CALLBACK_HANDOVER_TEXT } from '@/lib/ai/lead-question';
import { buildEnquiryAckText } from '@/lib/whatsapp/enquiry-card';
import { propertyShowcaseUrl } from '@/lib/share-message-builder';
import { accountShowcaseOrigin } from '@/lib/showcase/account-showcase-url';
import {
  buildPreferenceSourceText,
  extractContactPreferences,
} from '@/lib/ai/preference-extraction';
import { rankProperties } from '@/lib/radar/engine';
import type { Contact, Property } from '@/types';

// POST /api/dev/simulate-chatbot
// Internal dev tool: runs the exact classify -> parse -> validate ->
// preview pipeline the WhatsApp owner chatbot uses (chatbot-engine.ts),
// without a real WhatsApp message, without creating a draft session,
// and without burning the account's AI credits — so you can iterate on
// prompts/parsing and see the precise preview text a real message would
// produce, safely and for free. Requires being signed into an account
// (any role) — never public.
//
// This deliberately does NOT call burnCredits(): it mirrors the
// account's own real classify/parse behavior via live Gemini calls
// (so the RESULT is representative), but the credit cost of running
// this tool is treated as a dev-tooling cost, not a production charge.

const MAX_TEXT_LEN = 5000;

export async function POST(request: Request) {
  try {
    // Any signed-in account member may use this — it's read-only
    // against their own account's AI pipeline, never another tenant's.
    const ctx = await requireRole('viewer');

    const body = (await request.json().catch(() => null)) as {
      text?: string;
      imageBase64?: string;
      mimeType?: string;
      mode?: 'owner_intake' | 'lead_reply';
      priorRequirements?: string;
      contactName?: string;
      subjectPropertyCode?: string;
    } | null;

    const text = (body?.text || '').trim().slice(0, MAX_TEXT_LEN);
    const imageBase64 = body?.imageBase64 || null;
    const mimeType = body?.mimeType || null;

    if (!text && !imageBase64) {
      return NextResponse.json({ error: 'Provide message text and/or an image.' }, { status: 400 });
    }

    if (body?.mode === 'lead_reply') {
      return simulateLeadReply({
        accountId: ctx.accountId,
        supabase: ctx.supabase,
        text,
        priorRequirements: (body.priorRequirements || '').trim().slice(0, MAX_TEXT_LEN),
        contactName: (body.contactName || '').trim() || null,
        subjectPropertyCode: (body.subjectPropertyCode || '').trim() || null,
      });
    }

    const mediaBuffer = imageBase64 ? Buffer.from(imageBase64, 'base64') : undefined;

    const classification = await classifyImageOrText(text, mediaBuffer, mimeType || undefined);

    if (classification === 'contact') {
      const container = mediaBuffer && mimeType
        ? await parseContactFromImageOrText(text, mediaBuffer, mimeType)
        : await parseContactFromImageOrText(text);
      const { isValid, missingFields } = validateContactDraftsContainer(container);
      const status = deriveDraftStatus(isValid);
      const previewText = formatContactDraftsPreview('📝 *Contact Drafts (simulated)*', container, status, missingFields);

      return NextResponse.json({ classification, draft: container, isValid, missingFields, status, previewText });
    }

    if (classification === 'schedule') {
      const draft = await parseEventFromInput({
        image: imageBase64 && mimeType ? { base64: imageBase64, mimeType } : undefined,
        text: text || undefined,
      });
      const startIso = istLocalToUtcIso(draft.start_time);
      const previewText = [
        '🗓 *Event Draft (simulated)*',
        `Intent: ${draft.intent}`,
        `${draft.title} — ${draft.event_type}`,
        startIso ? `When: ${new Date(startIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}` : 'When: unresolved',
        draft.contact_name ? `With: ${draft.contact_name}` : null,
        draft.location ? `Where: ${draft.location}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join('\n');

      return NextResponse.json({
        classification,
        draft,
        isValid: draft.intent !== 'none',
        missingFields: startIso ? [] : ['start_time'],
        status: null,
        previewText,
      });
    }

    if (classification === 'property') {
      let draft = mediaBuffer && mimeType
        ? await parseListingFromImageOrText(text, mediaBuffer, mimeType)
        : await parseListingFromImageOrText(text);
      draft = await backfillLocationFromMapLink(draft);
      const { isValid, missingFields } = validateDraft(draft);
      const status = deriveDraftStatus(isValid);
      const previewText = formatDraftPreviewMessage('📝 *Listing Draft (simulated)*', draft, status, missingFields);

      return NextResponse.json({ classification, draft, isValid, missingFields, status, previewText });
    }

    if (classification === 'client_reply') {
      const draft = mediaBuffer && mimeType
        ? await parseClientReplyFromImageOrText(text, mediaBuffer, mimeType)
        : await parseClientReplyFromImageOrText(text);
      const previewText = [
        '💬 *Client Reply (simulated)*',
        draft.client_name ? `Client: ${draft.client_name}` : null,
        draft.property_code || draft.property_title
          ? `Property: ${[draft.property_title, draft.property_code].filter(Boolean).join(' ')}`
          : null,
        draft.response_summary ? `Response: ${draft.response_summary}` : null,
        draft.next_action ? `Next: ${draft.next_action}` : null,
        draft.timeline_hint ? `When: ${draft.timeline_hint}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join('\n');

      return NextResponse.json({
        classification,
        draft,
        isValid: Boolean(draft.response_summary),
        missingFields: draft.response_summary ? [] : ['response_summary'],
        status: null,
        previewText,
      });
    }

    // Neither property nor contact — the real bot would not start a
    // draft session; surface the raw classification for visibility.
    return NextResponse.json({ classification, draft: null, isValid: null, missingFields: [], status: null, previewText: null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Dry run of the lead path: the same routing decision, the same signal
// gate, the same extraction, the same ladder and the same reply
// builders the live handler uses — against this account's real
// inventory, but with nothing sent, nothing written to the contact, and
// no credits burned.
//
// Routing comes FIRST, because the ladder is no longer the only thing
// that answers a lead. Three kinds of message are carved out of it
// (see lead-routing), and this tool used to know about none of them:
// an agent typing "can I get photos" was shown the ladder's "what kind
// of property are you looking for?", which is the exact reply the
// carve-out exists to prevent.
//
// `priorRequirements` stands in for what the contact already has on
// file, which is how a mid-ladder turn is reproduced: put the earlier
// answers there and send only the newest one as `text`.
async function simulateLeadReply(args: {
  accountId: string;
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  text: string;
  priorRequirements: string;
  contactName: string | null;
  subjectPropertyCode: string | null;
}): Promise<NextResponse> {
  const {
    accountId,
    supabase,
    text,
    priorRequirements,
    contactName,
    subjectPropertyCode,
  } = args;

  const route = routeLeadMessage(text);
  if (route !== 'qualification') {
    return simulateCarveOut({
      accountId,
      supabase,
      route,
      text,
      subjectPropertyCode,
    });
  }

  const hasSignal = carriesRequirementSignal(text);
  const requirements = appendRequirement(priorRequirements, text);
  const sourceText = buildPreferenceSourceText(requirements, null);
  const preferences = await extractContactPreferences(sourceText);

  const { data: properties } = await supabase
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_published', true)
    .eq('status', 'Available');

  // The contact the ladder would be reasoning about, built in memory
  // from the extraction — never inserted.
  const simulatedContact = {
    id: 'simulated-contact',
    account_id: accountId,
    name: contactName,
    classification: 'Buyer',
    requirement_active: true,
    requirements,
    pref_property_types: preferences.property_types,
    pref_property_categories: preferences.property_categories,
    pref_bhk_min: preferences.bhk_min,
    pref_bhk_max: preferences.bhk_max,
    pref_budget_min: preferences.budget_min,
    pref_budget_max: preferences.budget_max,
    pref_areas: preferences.areas,
    pref_excluded_areas: preferences.excluded_areas,
    pref_projects: preferences.projects,
    pref_min_roi: preferences.min_roi,
    pref_listing_types: preferences.listing_types,
    pref_extracted_at: new Date().toISOString(),
  } as unknown as Contact;

  // strict_area_match mirrors the live handler's tighter 5km radius.
  const matches = rankProperties(
    { ...simulatedContact, strict_area_match: true },
    (properties || []) as Property[]
  );

  const areaSuggestions = tallyAreaSuggestions((properties || []) as Property[]);

  const origin = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const outcome = buildQualificationReply(
    preferences,
    contactName,
    matches,
    areaSuggestions,
    origin,
    'simulated-contact'
  );

  return NextResponse.json({
    mode: 'lead_reply',
    route: 'qualification' satisfies LeadRoute,
    routeExplanation: LEAD_ROUTE_EXPLANATIONS.qualification,
    // False means the live handler answers only if this text arrived
    // directly after a bot question; on its own it would be left alone.
    carriesRequirementSignal: hasSignal,
    requirements,
    preferences,
    nextQualifier: outcome.missing,
    matchCount: matches.length,
    matches: matches.slice(0, 3).map((m) => ({
      title: m.property.title,
      score: m.score,
      location: [m.property.sublocality, m.property.city].filter(Boolean).join(', '),
    })),
    inventorySize: (properties || []).length,
    previewText: outcome.reply,
  });
}

/**
 * The three routes the ladder stands down for.
 *
 * Which listing the lead is looking at comes off the share ledger in
 * production, and there is no contact here to have a ledger — so the
 * agent names it with `subjectPropertyCode`. Left empty, the preview
 * shows the handover the live bot sends when the thread cannot be
 * pinned to a listing, which is a real outcome worth being able to see.
 */
async function simulateCarveOut(args: {
  accountId: string;
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'];
  route: Exclude<LeadRoute, 'qualification'>;
  text: string;
  subjectPropertyCode: string | null;
}): Promise<NextResponse> {
  const { accountId, supabase, route, text, subjectPropertyCode } = args;

  const base = {
    mode: 'lead_reply' as const,
    route,
    routeExplanation: LEAD_ROUTE_EXPLANATIONS[route],
    // The carve-outs run before any extraction: nothing is filed on the
    // contact and no Gemini call is made, in the tool exactly as live.
    carriesRequirementSignal: carriesRequirementSignal(text),
    preferences: null,
    nextQualifier: null,
    ladderStoodDown: true,
  };

  if (route === 'callback_handover') {
    return NextResponse.json({
      ...base,
      previewText: CALLBACK_HANDOVER_TEXT,
      notifiesAgent: true,
    });
  }

  if (route === 'shortlist_reference') {
    return NextResponse.json({
      ...base,
      previewText: null,
      answeredFromListing: true,
    });
  }

  const subject = subjectPropertyCode
    ? await loadSubjectByCode(supabase, accountId, subjectPropertyCode)
    : null;

  if (route === 'property_enquiry') {
    // The buyer's half of the flow — the Approve/Reject card goes to
    // the agent, and approving is what releases the details.
    return NextResponse.json({
      ...base,
      previewText: buildEnquiryAckText(null, subject?.title ?? null),
      notifiesAgent: true,
    });
  }

  if (!subject) {
    return NextResponse.json({
      ...base,
      previewText: photoHandoverText(null),
      notifiesAgent: true,
      photoCount: 0,
    });
  }

  const images = (subject.images || []).filter((u) => u && u.trim().length > 0);
  if (images.length === 0) {
    return NextResponse.json({
      ...base,
      previewText: photoHandoverText(subject.title),
      notifiesAgent: true,
      photoCount: 0,
    });
  }

  const origin = await accountShowcaseOrigin(supabase, accountId);
  const sent = plannedPhotoCount(images.length, 1);
  return NextResponse.json({
    ...base,
    photoCount: sent,
    galleryCount: images.length,
    previewText: buildPhotoReplyText([
      {
        title: subject.title,
        sent,
        total: images.length,
        url: `${propertyShowcaseUrl(origin.endsWith('/') ? origin : `${origin}/`, subject)}&v=simulated-contact`,
      },
    ]),
  });
}

/** The listing an agent named, by the brokerage's own property code. */
async function loadSubjectByCode(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  code: string
): Promise<Pick<Property, 'id' | 'title' | 'images' | 'property_code'> | null> {
  const { data } = await supabase
    .from('properties')
    .select('id, title, images, property_code')
    .eq('account_id', accountId)
    .ilike('property_code', code)
    .maybeSingle();
  return (data as Pick<
    Property,
    'id' | 'title' | 'images' | 'property_code'
  > | null) ?? null;
}

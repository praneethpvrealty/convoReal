import {
  answerLeadQuestion,
  looksLikeQuestion,
  mergeLeadAnswers,
  previousLeadQuestion,
  questionSubjectProperties,
  requestsHumanContact,
  subjectPortalListings,
  type LeadAnswer,
} from '@/lib/ai/lead-question';
import { referencesSharedListing } from '@/lib/ai/described-listing';
import {
  markBotInstructionsFired,
  retrieveBotInstructions,
} from '@/lib/ai/bot-instructions';
import {
  photoHandoverText,
  requestsPropertyPhotos,
  sendSubjectPhotos,
} from '@/lib/ai/photo-request';
import { parseOrdinalReferences } from '@/lib/ai/shortlist-reference';
import { createNotification } from '@/lib/notifications/create';
import { relayLeadMessageToBridgedAgent } from '@/lib/whatsapp/reply-bridge';
import { sendWhatsAppMessageAndPersist } from '@/lib/whatsapp/meta-api-dispatcher';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { InboundChainContext, StepResult } from '../context';

export function withoutHandovers(
  answers: LeadAnswer[],
  subjects: { title?: string | null }[]
): LeadAnswer | null {
  const kept = answers.flatMap((answer, i) =>
    answer.source === 'handover' ? [] : [{ answer, subject: subjects[i] ?? {} }]
  );
  if (kept.length === 0) return null;
  if (kept.length === answers.length)
    return mergeLeadAnswers(answers, subjects);
  const merged = mergeLeadAnswers(
    kept.map((k) => k.answer),
    kept.map((k) => k.subject)
  );
  return {
    ...merged,
    text: kept
      .map(({ answer, subject }) => {
        const title = subject.title?.trim();
        return title ? `*${title}*\n${answer.text}` : answer.text;
      })
      .join('\n\n'),
  };
}

export async function leadQuestion(
  ctx: InboundChainContext
): Promise<StepResult> {
  const {
    accountId,
    message,
    configOwnerUserId,
    senderPhone,
    ownerCheck,
    contactRecord,
    conversation,
    assignedAgentUserId,
    buyerRequirementMessage,
    isPropertyOwnerSender,
    inboundText,
    tappedHumanRequest,
    flowConsumed,
    agentHandling,
  } = ctx;
  // A lead's question nothing above claimed. Answer it from the listing
  // they were last sent — free fields first, then Gemini grounded in
  // those same fields — and when neither can, say so and put a person
  // on it rather than guessing or going quiet.
  if (
    !flowConsumed &&
    !buyerRequirementMessage &&
    !ownerCheck.isOwner &&
    !isPropertyOwnerSender &&
    (tappedHumanRequest !== null ||
      (message.type === 'text' &&
        (looksLikeQuestion(inboundText) ||
          requestsHumanContact(inboundText) ||
          // "Sir can I get images" is not question-shaped either, but it
          // asks for the listing's own photos, which we hold.
          requestsPropertyPhotos(inboundText) ||
          // "Option 2" is not question-shaped, but the shortlist that
          // numbered it closed with "reply with the number", so it is an
          // answer to us and it is about one listing.
          parseOrdinalReferences(inboundText).length > 0 ||
          // "No this 40,000 sqft one" is a correction: it names the
          // listing, and the question it belongs to was asked just
          // before it.
          referencesSharedListing(inboundText))))
  ) {
    const leadText = tappedHumanRequest ?? inboundText;
    const admin = supabaseAdmin();
    // Plural: a buyer who asks about "options 1 & 2" asked two
    // questions, and answering only the first leaves the second
    // hanging on a listing they had already numbered for us.
    // The buyer's message and the one they swiped to quote travel with
    // the question: a quoted share names its listing outright.
    const subjects = await questionSubjectProperties(
      admin,
      accountId,
      contactRecord.id,
      conversation.id,
      leadText,
      { messageId: message.id, quotedMessageId: message.context?.id ?? null }
    );

    // A photo request is answered with the photos themselves, not with
    // prose about them. When they cannot be sent — no listing pinned to
    // the thread, or a gallery the confidential switch emptied — the
    // handover below promises them and summons the person who has them.
    // A lead asking to be called stays with the callback branch even
    // when photos are mentioned: a person was requested, so a person
    // answers.
    const photoRequest =
      requestsPropertyPhotos(leadText) && !requestsHumanContact(leadText);
    // A message that only points at a listing is answered with the
    // question the buyer asked just before it, for that listing.
    const pointsOnly =
      subjects.length > 0 &&
      referencesSharedListing(leadText) &&
      !looksLikeQuestion(leadText) &&
      !requestsHumanContact(leadText) &&
      !photoRequest;
    const question = pointsOnly
      ? ((await previousLeadQuestion(admin, conversation.id, leadText)) ??
        leadText)
      : leadText;
    let answer: LeadAnswer;
    let reply: LeadAnswer | null;
    if (photoRequest) {
      const sentPhotos = await sendSubjectPhotos({
        db: admin,
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        propertyIds: subjects.map((s) => s.id),
        requestText: leadText,
      });
      if (sentPhotos) return 'handled';
      answer = {
        text: photoHandoverText(subjects[0]?.title),
        source: 'handover',
      };
      reply = agentHandling ? null : answer;
    } else {
      const { data: qaConfig } = await admin
        .from('whatsapp_config')
        .select('share_seller_final_price')
        .eq('account_id', accountId)
        .maybeSingle();
      const answers = await Promise.all(
        (subjects.length > 0 ? subjects : [null]).map(async (subject) => {
          const [portalListings, botInstructions] = await Promise.all([
            subject
              ? subjectPortalListings(admin, accountId, subject.id)
              : Promise.resolve([]),
            retrieveBotInstructions(admin, {
              accountId,
              contactClassification:
                (contactRecord as { classification?: string | null })
                  .classification ?? null,
              listingType: subject?.listing_type ?? null,
              language:
                (contactRecord as { preferred_language?: string | null })
                  .preferred_language ?? null,
            }),
          ]);
          return answerLeadQuestion({
            accountId,
            question,
            property: subject,
            shareSellerFinalPrice: qaConfig?.share_seller_final_price === true,
            portalListings,
            botInstructions,
          });
        })
      );
      answer = mergeLeadAnswers(answers, subjects);
      reply = agentHandling ? withoutHandovers(answers, subjects) : answer;
    }

    if (reply) {
      await sendWhatsAppMessageAndPersist({
        accountId,
        userId: configOwnerUserId,
        contactId: contactRecord.id,
        conversationId: conversation.id,
        kind: 'text',
        senderType: 'bot',
        text: reply.text,
      });

      await markBotInstructionsFired(
        admin,
        accountId,
        reply.appliedInstructionIds ?? []
      );
    }

    if (answer.source === 'handover') {
      // The lead has been promised a person, so make sure one hears
      // about it: notification, the agent's own WhatsApp, and the
      // thread flagged for whoever is on duty.
      await createNotification({
        accountId,
        userId: assignedAgentUserId,
        type: 'new_message',
        title: `Question needs you: ${contactRecord.name || senderPhone}`,
        body: leadText.slice(0, 140),
        entityType: 'conversation',
        entityId: conversation.id,
        link: `/inbox?conversation=${conversation.id}`,
      });
      await relayLeadMessageToBridgedAgent({
        accountId,
        conversationId: conversation.id,
        leadName: contactRecord.name || senderPhone,
        body: leadText,
      });
      await admin
        .from('conversations')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', conversation.id)
        .eq('account_id', accountId)
        .select('id');
    }
    return 'handled';
  }
  return 'continue';
}

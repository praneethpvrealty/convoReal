// ============================================================
// Transcript rules — what a buyer conversation must never read like,
// checked over the whole thread rather than one sentence.
//
// Every bubble in the 7 October 2026 JP Nagar thread came from code
// that passed its own unit test, and the lead still got five bot
// messages in seventy seconds: two templates that contradicted each
// other, three ways of saying "nothing", and no listing after a button
// that said "Show Properties". These rules read the thread the way the
// lead did. They run in three places: the replay harness
// (portal-lead.transcript.test.ts), the pinned fixtures
// (transcript-fixtures.test.ts) and the nightly bot thread review.
// ============================================================

export type TranscriptSender = 'customer' | 'bot' | 'agent';

export interface TranscriptMessage {
  sender: TranscriptSender;
  kind: 'text' | 'template' | 'interactive' | 'media' | 'other';
  text: string;
  templateName?: string | null;
  at?: string;
}

export interface TranscriptContext {
  /** When the lead was created; a lead younger than a week is answering
   *  their own enquiry, not coming back. */
  contactCreatedAt?: string | null;
  /** How many bot bubbles one customer turn may earn. The arrival burst
   *  (before the lead has written) counts as a turn too. */
  maxBotBubblesPerTurn?: number;
}

export type TranscriptRuleId =
  | 'bot-burst'
  | 'contradictory-arrival'
  | 'unavailable-repeated'
  | 'dead-end-without-link'
  | 'self-praise'
  | 'returning-copy-for-new-lead'
  | 'promise-without-listing';

export interface TranscriptViolation {
  rule: TranscriptRuleId;
  /** Index into the transcript of the bubble that broke the rule. */
  index: number;
  note: string;
}

export const DEFAULT_MAX_BOT_BUBBLES_PER_TURN = 2;

const RE_ENGAGED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const UNAVAILABLE =
  /no longer available|not available right now|already been sold|is (currently )?under contract|off the market for now|not actively listed/i;
const PROMISES_LISTINGS =
  /i will share|i'll share|share the appropriate properties|send you the best matching|here are \d+ live|here's one live|listings match what you're looking for|closest available options/i;
const DEAD_END =
  /nothing live right now fits|nothing in our inventory fits|i don't have .{0,80} live right now|no longer available|not available right now|already been sold|is (currently )?under contract|off the market/i;
const SHOWS_LISTING =
  /https?:\/\/\S+(property_id=|ids=)|here are \d+ live|here's one live|listings match what you're looking for|closest available options|here's the property you enquired about|that fit 👇/i;
const SELF_PRAISE =
  /intelligent matching engine|our (advanced|smart|powerful) (ai|engine|algorithm)|state-of-the-art/i;
const RETURNING_COPY =
  /back on our radar|great to hear from you again|welcome back/i;
const SHOW_PROPERTIES_TAP =
  /^🔘 Button: "(show (me )?properties|send listings|show matches|matches)"$/i;
const LINK = /https?:\/\/\S+/i;

function isReEngaged(createdAt: string | null | undefined, at?: string) {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(created)) return true;
  const now = at ? Date.parse(at) : NaN;
  return (
    (Number.isFinite(now) ? now : Date.now()) - created >= RE_ENGAGED_AFTER_MS
  );
}

/**
 * Bot bubbles grouped by the customer turn they answer: everything the
 * bot sends before the lead writes is turn 0, then each customer
 * message opens a new turn.
 */
export function botTurns(
  transcript: TranscriptMessage[]
): Array<{ indexes: number[]; customerIndex: number | null }> {
  const turns: Array<{ indexes: number[]; customerIndex: number | null }> = [
    { indexes: [], customerIndex: null },
  ];
  transcript.forEach((message, index) => {
    if (message.sender === 'customer') {
      turns.push({ indexes: [], customerIndex: index });
    } else if (message.sender === 'bot') {
      turns[turns.length - 1].indexes.push(index);
    }
  });
  return turns.filter((turn) => turn.indexes.length > 0);
}

export function checkTranscript(
  transcript: TranscriptMessage[],
  context: TranscriptContext = {}
): TranscriptViolation[] {
  const violations: TranscriptViolation[] = [];
  const maxPerTurn =
    context.maxBotBubblesPerTurn ?? DEFAULT_MAX_BOT_BUBBLES_PER_TURN;

  for (const turn of botTurns(transcript)) {
    if (turn.indexes.length > maxPerTurn) {
      violations.push({
        rule: 'bot-burst',
        index: turn.indexes[maxPerTurn],
        note: `${turn.indexes.length} bot bubbles for one customer turn (limit ${maxPerTurn})`,
      });
    }
    if (turn.customerIndex === null) {
      const texts = turn.indexes.map((i) => transcript[i].text);
      const promises = turn.indexes.filter((i) =>
        PROMISES_LISTINGS.test(transcript[i].text)
      );
      const unavailable = turn.indexes.filter((i) =>
        UNAVAILABLE.test(transcript[i].text)
      );
      if (
        promises.length > 0 &&
        unavailable.length > 0 &&
        !texts.some((t) => PROMISES_LISTINGS.test(t) && UNAVAILABLE.test(t))
      ) {
        violations.push({
          rule: 'contradictory-arrival',
          index: unavailable[0],
          note: 'arrival promised listings in one bubble and withdrew the listing in the next',
        });
      }
    }
    const customer =
      turn.customerIndex === null ? null : transcript[turn.customerIndex];
    if (
      customer &&
      SHOW_PROPERTIES_TAP.test(customer.text.trim()) &&
      !turn.indexes.some((i) => SHOWS_LISTING.test(transcript[i].text))
    ) {
      violations.push({
        rule: 'promise-without-listing',
        index: turn.indexes[0],
        note: 'the lead tapped a button that promised properties and was shown none',
      });
    }
  }

  let unavailableSaid = 0;
  transcript.forEach((message, index) => {
    if (message.sender !== 'bot') return;
    const { text } = message;
    if (UNAVAILABLE.test(text)) {
      unavailableSaid += 1;
      if (unavailableSaid > 1) {
        violations.push({
          rule: 'unavailable-repeated',
          index,
          note: 'the thread already told the lead the listing is unavailable',
        });
      }
    }
    if (
      message.kind !== 'template' &&
      DEAD_END.test(text) &&
      !LINK.test(text)
    ) {
      violations.push({
        rule: 'dead-end-without-link',
        index,
        note: 'a dead end that hands the lead nowhere to browse',
      });
    }
    if (SELF_PRAISE.test(text)) {
      violations.push({
        rule: 'self-praise',
        index,
        note: 'the bot praising its own engine to a buyer',
      });
    }
    if (
      RETURNING_COPY.test(text) &&
      !isReEngaged(context.contactCreatedAt, message.at)
    ) {
      violations.push({
        rule: 'returning-copy-for-new-lead',
        index,
        note: 'welcomed back a lead who wrote for the first time this week',
      });
    }
  });

  return violations;
}

/** Rows as the inbox stores them, mapped onto the shape the rules read. */
export function transcriptFromMessages(
  rows: Array<{
    sender_type: string | null;
    content_type: string | null;
    content_text: string | null;
    template_name?: string | null;
    created_at?: string | null;
  }>
): TranscriptMessage[] {
  return rows.map((row) => ({
    sender:
      row.sender_type === 'customer'
        ? 'customer'
        : row.sender_type === 'bot'
          ? 'bot'
          : 'agent',
    kind:
      row.content_type === 'template'
        ? 'template'
        : row.content_type === 'interactive'
          ? 'interactive'
          : row.content_type === 'text'
            ? 'text'
            : row.content_type === 'image' ||
                row.content_type === 'video' ||
                row.content_type === 'document'
              ? 'media'
              : 'other',
    text: row.content_text ?? '',
    templateName: row.template_name ?? null,
    at: row.created_at ?? undefined,
  }));
}

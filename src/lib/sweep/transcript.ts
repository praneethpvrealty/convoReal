// ============================================================
// A thread, rendered for a model to read.
//
// Two constraints pull against each other here. The analyser is asked
// to spot a promise made on Tuesday and not kept by Thursday, so it
// needs the thread and not the last bubble — that is the entire
// reason this pass exists rather than more regex in chat-learning.
// But a sweep runs over every active thread in every account once a
// day, so an unbounded transcript is an unbounded bill.
//
// The compromise is a hard character budget spent from the END. The
// newest exchange is the one a gap is about; an eighty-message thread
// truncated from the front loses the greeting, which nobody needed.
// ============================================================

import type { SweepMessage, SweepThread } from './types';

/** About 25k characters of Gemini input per thread. Threads longer
 *  than this are rare and their tails are what matter. */
const TRANSCRIPT_BUDGET = 25_000;

/** One line past this is a pasted brochure, not a sentence someone
 *  typed. Kept, but clipped — the fact is always near the start. */
const MAX_LINE = 1_200;

const SPEAKER_LABEL: Record<SweepMessage['speaker'], string> = {
  customer: 'CLIENT',
  agent: 'AGENT',
  bot: 'BOT',
};

/** Media with no caption says nothing a language model can read, but
 *  its PRESENCE is evidence — "sent the floor plan" is answered by an
 *  image at 4:02pm. So it becomes a marker rather than disappearing. */
function renderText(message: SweepMessage): string {
  const text = (message.text || '').replace(/\s+/g, ' ').trim();
  if (text)
    return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text;
  if (message.contentType && message.contentType !== 'text') {
    return `[sent ${message.contentType}]`;
  }
  return '';
}

/** 'Tue 14:32' — enough for a model to reason about "the next day"
 *  without spending tokens on a full ISO stamp per line. */
export function stampFor(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '??';
  const ist = new Date(at.getTime() + 330 * 60_000);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    ist.getUTCDay()
  ];
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm}`;
}

export function renderTranscript(
  thread: SweepThread,
  budget = TRANSCRIPT_BUDGET
): string {
  const lines: string[] = [];
  let used = 0;

  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    const body = renderText(message);
    if (!body) continue;
    const line = `[${stampFor(message.createdAt)}] ${SPEAKER_LABEL[message.speaker]}: ${body}`;
    if (used + line.length > budget) break;
    used += line.length + 1;
    lines.push(line);
  }

  return lines.reverse().join('\n');
}

/**
 * Is this thread worth a model call at all?
 *
 * The gate is deliberately structural rather than linguistic. A
 * keyword list here would repeat chat-learning's mistake at a bigger
 * scale — the whole point of the sweep is to catch what the narrow
 * in-the-moment gate missed, so it must not be gated by a narrower
 * one. What it does refuse is threads with nothing to read: pure
 * media, a single automated blast, an outbound template nobody
 * answered.
 */
export function worthAnalyzing(thread: SweepThread): boolean {
  const spoken = thread.messages.filter(
    (m) => (m.text || '').trim().length > 1
  );
  if (spoken.length < 2) return false;

  const humanSides = new Set(
    spoken.filter((m) => m.speaker !== 'bot').map((m) => m.speaker)
  );
  // Personal WhatsApp reaches us outbound-only, so "both sides spoke"
  // is a test it can never pass and must not be held to.
  if (thread.channel === 'personal_whatsapp') return spoken.length >= 2;
  return humanSides.size > 0 && spoken.length >= 3;
}
